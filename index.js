"use strict";

/**
 * Trusted order API for Hamburgueria Na Brasa.
 *
 * Important security boundaries:
 * - Prices and delivery fees are recalculated here from Firestore/configuration.
 * - Clients never write an order document directly.
 * - Only PIX is accepted at this stage. This stores a payment choice; it does
 *   not collect card data or confirm a financial transaction.
 * - Every public callable requires Firebase App Check in production.
 */

const crypto = require("crypto");
const { getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

const REGION = "southamerica-east1";
const CURRENCY = "BRL";
const MAX_LINE_ITEMS = 12;
const MAX_TOTAL_QUANTITY = 20;
const MAX_TOTAL_CENTS = 1000000;
const TRACKING_CODE_PATTERN = /^NB[A-F0-9]{18}$/;
const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

const STATUS = Object.freeze({
  RECEIVED: "RECEBIDO",
  PREPARING: "EM_PREPARO",
  ON_THE_WAY: "A_CAMINHO",
  DELIVERED: "ENTREGUE",
  CANCELLED: "CANCELADO"
});

const STATUS_LABELS = Object.freeze({
  [STATUS.RECEIVED]: "Recebido",
  [STATUS.PREPARING]: "Em preparo",
  [STATUS.ON_THE_WAY]: "A caminho",
  [STATUS.DELIVERED]: "Entregue",
  [STATUS.CANCELLED]: "Cancelado"
});

const ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  [STATUS.RECEIVED]: new Set([STATUS.PREPARING, STATUS.CANCELLED]),
  [STATUS.PREPARING]: new Set([STATUS.ON_THE_WAY, STATUS.CANCELLED]),
  [STATUS.ON_THE_WAY]: new Set([STATUS.DELIVERED]),
  [STATUS.DELIVERED]: new Set(),
  [STATUS.CANCELLED]: new Set()
});

// This is intentionally server-side. Replace or extend these rules only in
// trusted code (or move them to a server-only settings document later).
const DELIVERY_RULES = Object.freeze([
  {
    id: "lavras-proxima",
    minCepPrefix: 37200,
    maxCepPrefix: 37202,
    feeCents: 599,
    minMinutes: 30,
    maxMinutes: 40,
    description: "Centro e bairros próximos"
  },
  {
    id: "lavras-intermediaria",
    minCepPrefix: 37203,
    maxCepPrefix: 37205,
    feeCents: 899,
    minMinutes: 35,
    maxMinutes: 45,
    description: "Bairros intermediários"
  },
  {
    id: "lavras-ampliada",
    minCepPrefix: 37206,
    maxCepPrefix: 37209,
    feeCents: 1199,
    minMinutes: 40,
    maxMinutes: 55,
    description: "Bairros mais distantes"
  }
]);

const callableOptions = {
  region: REGION,
  memory: "256MiB",
  timeoutSeconds: 20,
  maxInstances: 10,
  // App Check is a first line of abuse protection for unauthenticated calls.
  // Register the reCAPTCHA/App Check provider in the web app before deploying.
  enforceAppCheck: true,
  cors: [
    "https://hamburgeria-ee939.web.app",
    "https://hamburgeria-ee939.firebaseapp.com",
    /^http:\/\/localhost:\d+$/,
    /^http:\/\/127\.0\.0\.1:\d+$/
  ]
};

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

function fail(code, message) {
  throw new HttpsError(code, message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, fieldName) {
  if (!isPlainObject(value)) {
    fail("invalid-argument", `${fieldName} é obrigatório.`);
  }
  return value;
}

function cleanText(value, fieldName, minLength, maxLength, required = true) {
  if ((value === undefined || value === null || value === "") && !required) {
    return "";
  }

  if (typeof value !== "string") {
    fail("invalid-argument", `${fieldName} é inválido.`);
  }

  const text = value.trim().replace(/\s+/g, " ");
  if (text.length < minLength || text.length > maxLength || /[\u0000-\u001F\u007F]/.test(text)) {
    fail("invalid-argument", `${fieldName} é inválido.`);
  }
  return text;
}

function normalizeCep(value) {
  const cep = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(cep)) {
    fail("invalid-argument", "Informe um CEP válido com 8 dígitos.");
  }
  return cep;
}

function formatCep(cep) {
  return `${cep.slice(0, 5)}-${cep.slice(5)}`;
}

function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  const localNumber = digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
    ? digits.slice(2)
    : digits;

  if (!/^\d{10,11}$/.test(localNumber)) {
    fail("invalid-argument", "Informe um WhatsApp válido.");
  }
  return `+55${localNumber}`;
}

function normalizePayment(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized !== "PIX") {
    fail("failed-precondition", "No momento, os pedidos pelo site aceitam apenas PIX.");
  }
  return "PIX";
}

function normalizeStatus(value) {
  const raw = String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]+/g, "_")
    .toUpperCase();

  const aliases = {
    RECEBIDO: STATUS.RECEIVED,
    EM_PREPARO: STATUS.PREPARING,
    PREPARANDO: STATUS.PREPARING,
    A_CAMINHO: STATUS.ON_THE_WAY,
    SAIU_PARA_ENTREGA: STATUS.ON_THE_WAY,
    ENTREGUE: STATUS.DELIVERED,
    CANCELADO: STATUS.CANCELLED
  };

  if (!aliases[raw]) {
    fail("invalid-argument", "Status de pedido inválido.");
  }
  return aliases[raw];
}

function calculateDelivery(cep) {
  const cepPrefix = Number(cep.slice(0, 5));
  const rule = DELIVERY_RULES.find((entry) => (
    cepPrefix >= entry.minCepPrefix && cepPrefix <= entry.maxCepPrefix
  ));
  if (!rule) {
    fail("failed-precondition", "No momento entregamos somente em Lavras, MG.");
  }

  return {
    zone: rule.id,
    description: rule.description,
    feeCents: rule.feeCents,
    minMinutes: rule.minMinutes,
    maxMinutes: rule.maxMinutes
  };
}

function deliveryResponse(cep, quote) {
  return {
    cep: formatCep(cep),
    currency: CURRENCY,
    feeCents: quote.feeCents,
    deliveryFeeCents: quote.feeCents,
    fee: quote.feeCents / 100,
    deliveryFee: quote.feeCents / 100,
    amount: quote.feeCents / 100,
    zone: quote.zone,
    area: quote.description,
    description: quote.description,
    estimatedDeliveryMinutes: {
      min: quote.minMinutes,
      max: quote.maxMinutes
    }
  };
}

function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > MAX_LINE_ITEMS) {
    fail("invalid-argument", "Informe de 1 a 12 itens no pedido.");
  }

  const grouped = new Map();
  let quantityTotal = 0;

  for (const rawItem of rawItems) {
    if (!isPlainObject(rawItem)) {
      fail("invalid-argument", "Há um item de pedido inválido.");
    }

    const productId = String(rawItem.productId ?? rawItem.id ?? "").trim().toLowerCase();
    const quantity = Number(rawItem.quantity ?? rawItem.qty ?? 1);
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(productId)) {
      fail("invalid-argument", "Há um produto inválido no pedido.");
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 8) {
      fail("invalid-argument", "A quantidade de um item é inválida.");
    }

    grouped.set(productId, (grouped.get(productId) ?? 0) + quantity);
    quantityTotal += quantity;
  }

  if (quantityTotal > MAX_TOTAL_QUANTITY) {
    fail("invalid-argument", "O pedido ultrapassa a quantidade máxima permitida.");
  }

  return [...grouped.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

function getOptionalObject(value) {
  return isPlainObject(value) ? value : {};
}

function normalizeIdempotencyKey(value) {
  if (value === undefined || value === null || value === "") {
    // The browser should always supply a random idempotency key. This fallback
    // keeps a malformed old client from blocking order creation, but it cannot
    // deduplicate a retry from that client.
    return `server-${crypto.randomUUID()}`;
  }
  const key = String(value).trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
    fail("invalid-argument", "A chave de confirmação do pedido é inválida.");
  }
  return key;
}

function normalizeCreateOrderPayload(data) {
  const root = requireObject(data, "Dados do pedido");
  const customer = getOptionalObject(root.customer);
  const delivery = getOptionalObject(root.delivery);
  const paymentObject = getOptionalObject(root.payment);

  const name = cleanText(customer.name ?? root.name, "Nome", 2, 100);
  const phone = normalizePhone(customer.phone ?? customer.whatsapp ?? root.phone ?? root.whatsapp);
  const cep = normalizeCep(delivery.cep ?? root.cep);
  const street = cleanText(
    delivery.street ?? delivery.address ?? delivery.line1 ?? customer.address ?? root.address,
    "Endereço",
    4,
    180
  );
  const number = cleanText(delivery.number ?? customer.number ?? root.number ?? "S/N", "Número", 1, 30);
  const complement = cleanText(
    delivery.complement ?? customer.complement ?? root.complement,
    "Complemento",
    0,
    80,
    false
  );
  const reference = cleanText(
    delivery.reference ?? customer.reference ?? root.reference,
    "Referência",
    0,
    120,
    false
  );
  const notes = cleanText(root.notes ?? root.observations, "Observações", 0, 500, false);
  const paymentMethod = normalizePayment(root.paymentMethod ?? paymentObject.method ?? root.payment);
  const ageConfirmed = root.ageConfirmed === true || root.ageConfirmation === true;
  const idempotencyKey = normalizeIdempotencyKey(root.idempotencyKey ?? root.clientRequestId ?? root.requestId);
  const items = normalizeItems(root.items ?? root.cart);

  return {
    customer: { name, phone },
    delivery: { cep, street, number, complement, reference },
    notes,
    paymentMethod,
    ageConfirmed,
    idempotencyKey,
    items
  };
}

function createTrackingCode() {
  return `NB${crypto.randomBytes(9).toString("hex").toUpperCase()}`;
}

function createHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function getPricedItems(items) {
  const refs = items.map((item) => db.collection("products").doc(item.productId));
  const snapshots = await db.getAll(...refs);

  return snapshots.map((snapshot, index) => {
    const requested = items[index];
    const product = snapshot.data();

    if (!snapshot.exists || !product || product.active !== true) {
      fail("failed-precondition", "Um ou mais itens não estão mais disponíveis.");
    }

    const priceCents = product.priceCents;
    if (!Number.isSafeInteger(priceCents) || priceCents < 1 || priceCents > MAX_TOTAL_CENTS) {
      logger.error("Invalid server catalog price", { productId: requested.productId });
      fail("internal", "Não foi possível calcular o pedido. Tente novamente.");
    }

    const name = cleanText(product.name, "Produto", 1, 160);
    const lineTotalCents = priceCents * requested.quantity;
    return {
      productId: requested.productId,
      name,
      category: typeof product.category === "string" ? product.category.slice(0, 60) : "",
      quantity: requested.quantity,
      unitPriceCents: priceCents,
      lineTotalCents,
      alcohol: product.alcohol === true
    };
  });
}

function toIso(value) {
  if (!value || typeof value.toDate !== "function") {
    return null;
  }
  return value.toDate().toISOString();
}

function publicTrackingPayload(order) {
  const status = order.status;
  return {
    found: true,
    code: order.trackingCode,
    trackingCode: order.trackingCode,
    status,
    statusLabel: STATUS_LABELS[status] ?? status,
    updatedAt: toIso(order.statusUpdatedAt ?? order.updatedAt ?? order.createdAt),
    estimatedDeliveryMinutes: order.delivery?.estimatedDeliveryMinutes ?? null,
    payment: {
      method: order.payment?.method ?? "PIX",
      status: order.payment?.status ?? "PENDING"
    }
  };
}

async function requireManager(request) {
  if (!request.auth) {
    fail("unauthenticated", "Faça login como gerente para continuar.");
  }

  const uid = request.auth.uid;
  const staffSnapshot = await db.collection("staff").doc(uid).get();
  const staff = staffSnapshot.exists ? staffSnapshot.data() : null;
  const staffIsManager = staff?.role === "manager" && staff?.active === true;
  const legacyClaimIsManager = request.auth.token?.manager === true;

  // staff/{uid} is the primary authorization source so an owner can onboard
  // a manager in the Firebase Console without downloading a service account.
  // The old custom claim is retained only as a safe migration fallback.
  // An existing staff record is authoritative: setting active:false must
  // revoke access immediately even if a stale legacy claim still exists.
  if (staffSnapshot.exists && !staffIsManager) {
    fail("permission-denied", "Sua conta de gerente não está ativa.");
  }
  if (!staffSnapshot.exists && !legacyClaimIsManager) {
    fail("permission-denied", "Apenas gerentes autenticados podem acessar pedidos.");
  }
  return uid;
}

function safeText(value, maxLength = 180) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function managerOrderPayload(orderId, order) {
  const delivery = getOptionalObject(order.delivery);
  const customer = getOptionalObject(order.customer);
  const payment = getOptionalObject(order.payment);
  const totals = getOptionalObject(order.totals);
  const items = Array.isArray(order.items) ? order.items.map((item) => ({
    productId: safeText(item?.productId, 64),
    name: safeText(item?.name, 160),
    category: safeText(item?.category, 60),
    quantity: Number.isSafeInteger(item?.quantity) ? item.quantity : 0,
    unitPriceCents: Number.isSafeInteger(item?.unitPriceCents) ? item.unitPriceCents : 0,
    lineTotalCents: Number.isSafeInteger(item?.lineTotalCents) ? item.lineTotalCents : 0,
    alcohol: item?.alcohol === true
  })) : [];

  return {
    orderId,
    id: orderId,
    code: safeText(order.trackingCode, 32),
    trackingCode: safeText(order.trackingCode, 32),
    status: safeText(order.status, 32),
    statusLabel: STATUS_LABELS[order.status] ?? safeText(order.status, 32),
    createdAt: toIso(order.createdAt),
    createdAtMs: typeof order.createdAt?.toMillis === "function" ? order.createdAt.toMillis() : null,
    updatedAt: toIso(order.statusUpdatedAt ?? order.updatedAt),
    customer: {
      name: safeText(customer.name, 100),
      phone: safeText(customer.phone, 20),
      address: safeText(delivery.street, 180),
      number: safeText(delivery.number, 30),
      complement: safeText(delivery.complement, 80),
      reference: safeText(delivery.reference, 120),
      cep: safeText(delivery.formattedCep ?? delivery.cep, 9)
    },
    delivery: {
      cep: safeText(delivery.formattedCep ?? delivery.cep, 9),
      street: safeText(delivery.street, 180),
      number: safeText(delivery.number, 30),
      complement: safeText(delivery.complement, 80),
      reference: safeText(delivery.reference, 120),
      feeCents: Number.isSafeInteger(delivery.feeCents) ? delivery.feeCents : 0,
      zone: safeText(delivery.zone, 80),
      estimatedDeliveryMinutes: delivery.estimatedDeliveryMinutes ?? null
    },
    items,
    notes: safeText(order.notes, 500),
    payment: {
      method: safeText(payment.method, 20),
      status: safeText(payment.status, 32)
    },
    totals: {
      currency: safeText(totals.currency, 8) || CURRENCY,
      subtotalCents: Number.isSafeInteger(totals.subtotalCents) ? totals.subtotalCents : 0,
      deliveryFeeCents: Number.isSafeInteger(totals.deliveryFeeCents) ? totals.deliveryFeeCents : 0,
      totalCents: Number.isSafeInteger(totals.totalCents) ? totals.totalCents : 0
    },
    ageConfirmed: order.ageConfirmed === true
  };
}

async function saveOrder({ normalized, pricedItems, quote }) {
  const subtotalCents = pricedItems.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const totalCents = subtotalCents + quote.feeCents;
  if (!Number.isSafeInteger(totalCents) || totalCents < 1 || totalCents > MAX_TOTAL_CENTS) {
    fail("invalid-argument", "O total do pedido é inválido.");
  }

  const containsAlcohol = pricedItems.some((item) => item.alcohol);
  if (containsAlcohol && !normalized.ageConfirmed) {
    fail("failed-precondition", "Confirme a maioridade para incluir bebida alcoólica.");
  }

  const payloadFingerprint = createHash(JSON.stringify({
    items: pricedItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    customer: normalized.customer,
    delivery: normalized.delivery,
    notes: normalized.notes,
    paymentMethod: normalized.paymentMethod,
    ageConfirmed: normalized.ageConfirmed
  }));
  const idempotencyDocumentId = createHash(normalized.idempotencyKey);
  const idempotencyRef = db.collection("orderRequests").doc(idempotencyDocumentId);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const trackingCode = createTrackingCode();
    const orderRef = db.collection("orders").doc();
    const trackingRef = db.collection("orderTracking").doc(trackingCode);
    const createdAt = Timestamp.now();
    const response = {
      code: trackingCode,
      trackingCode,
      orderCode: trackingCode,
      status: STATUS.RECEIVED,
      statusLabel: STATUS_LABELS[STATUS.RECEIVED],
      currency: CURRENCY,
      subtotalCents,
      deliveryFeeCents: quote.feeCents,
      totalCents,
      payment: { method: "PIX", status: "PENDING" },
      estimatedDeliveryMinutes: { min: quote.minMinutes, max: quote.maxMinutes }
    };

    const result = await db.runTransaction(async (transaction) => {
      const idempotencySnapshot = await transaction.get(idempotencyRef);
      if (idempotencySnapshot.exists) {
        const existing = idempotencySnapshot.data();
        if (existing.payloadFingerprint !== payloadFingerprint || !isPlainObject(existing.response)) {
          fail("already-exists", "Esta confirmação de pedido já foi utilizada.");
        }
        return existing.response;
      }

      const trackingSnapshot = await transaction.get(trackingRef);
      if (trackingSnapshot.exists) {
        return null;
      }

      const order = {
        schemaVersion: 1,
        trackingCode,
        status: STATUS.RECEIVED,
        statusUpdatedAt: createdAt,
        statusHistory: [{
          status: STATUS.RECEIVED,
          at: createdAt,
          actor: "customer"
        }],
        customer: normalized.customer,
        delivery: {
          ...normalized.delivery,
          formattedCep: formatCep(normalized.delivery.cep),
          zone: quote.zone,
          description: quote.description,
          feeCents: quote.feeCents,
          estimatedDeliveryMinutes: { min: quote.minMinutes, max: quote.maxMinutes }
        },
        items: pricedItems,
        itemCount: pricedItems.reduce((sum, item) => sum + item.quantity, 0),
        notes: normalized.notes,
        payment: {
          method: "PIX",
          status: "PENDING",
          processor: "MANUAL_CONFIRMATION"
        },
        ageConfirmed: containsAlcohol ? true : false,
        totals: {
          currency: CURRENCY,
          subtotalCents,
          deliveryFeeCents: quote.feeCents,
          totalCents
        },
        createdAt,
        updatedAt: createdAt
      };

      transaction.create(orderRef, order);
      transaction.create(trackingRef, {
        orderId: orderRef.id,
        createdAt,
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 1000 * 60 * 60 * 24 * 90))
      });
      transaction.create(idempotencyRef, {
        orderId: orderRef.id,
        payloadFingerprint,
        response,
        createdAt,
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 1000 * 60 * 60 * 24 * 7))
      });

      return response;
    });

    if (result) {
      logger.info("Order created or safely replayed", { trackingCode: result.trackingCode });
      return result;
    }
  }

  fail("internal", "Não foi possível gerar o código do pedido. Tente novamente.");
}

exports.quoteDelivery = onCall(callableOptions, async (request) => {
  const data = requireObject(request.data, "Dados da entrega");
  const cep = normalizeCep(data.cep ?? data.postalCode);
  const quote = calculateDelivery(cep);
  return deliveryResponse(cep, quote);
});

exports.createOrder = onCall(callableOptions, async (request) => {
  const normalized = normalizeCreateOrderPayload(request.data);
  const quote = calculateDelivery(normalized.delivery.cep);
  const pricedItems = await getPricedItems(normalized.items);
  return saveOrder({ normalized, pricedItems, quote });
});

async function handleTracking(request) {
  const data = requireObject(request.data, "Código do pedido");
  const trackingCode = String(data.code ?? data.trackingCode ?? data.orderCode ?? "")
    .trim()
    .toUpperCase();
  if (!TRACKING_CODE_PATTERN.test(trackingCode)) {
    fail("invalid-argument", "Informe um código de pedido válido.");
  }

  const trackingSnapshot = await db.collection("orderTracking").doc(trackingCode).get();
  if (!trackingSnapshot.exists) {
    fail("not-found", "Pedido não encontrado.");
  }

  const orderId = trackingSnapshot.data().orderId;
  if (!ORDER_ID_PATTERN.test(String(orderId ?? ""))) {
    logger.error("Invalid tracking mapping", { trackingCode });
    fail("not-found", "Pedido não encontrado.");
  }

  const orderSnapshot = await db.collection("orders").doc(orderId).get();
  if (!orderSnapshot.exists) {
    logger.error("Missing order for tracking mapping", { trackingCode });
    fail("not-found", "Pedido não encontrado.");
  }

  return publicTrackingPayload(orderSnapshot.data());
}

// `getOrderTracking` remains as a compatibility alias; new clients should use
// `trackOrder`, which is the name used by the web application.
exports.trackOrder = onCall(callableOptions, handleTracking);
exports.getOrderTracking = onCall(callableOptions, handleTracking);

exports.listManagerOrders = onCall(callableOptions, async (request) => {
  await requireManager(request);
  const data = isPlainObject(request.data) ? request.data : {};
  const requestedLimit = data.limit === undefined ? 100 : Number(data.limit);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
    fail("invalid-argument", "O limite deve ficar entre 1 e 100 pedidos.");
  }

  const requestedStatus = data.status === undefined || data.status === ""
    ? null
    : normalizeStatus(data.status);
  let query = db.collection("orders");
  if (requestedStatus) {
    query = query.where("status", "==", requestedStatus);
  }
  const snapshot = await query.orderBy("createdAt", "desc").limit(requestedLimit).get();
  return {
    orders: snapshot.docs.map((document) => managerOrderPayload(document.id, document.data())),
    count: snapshot.size
  };
});

exports.updateOrderStatus = onCall(callableOptions, async (request) => {
  const managerUid = await requireManager(request);
  const data = requireObject(request.data, "Dados da atualização");
  const orderId = String(data.orderId ?? "").trim();
  const nextStatus = normalizeStatus(data.status);
  const note = cleanText(data.note ?? "", "Observação", 0, 300, false);

  if (!ORDER_ID_PATTERN.test(orderId)) {
    fail("invalid-argument", "Pedido inválido.");
  }

  const orderRef = db.collection("orders").doc(orderId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(orderRef);
    if (!snapshot.exists) {
      fail("not-found", "Pedido não encontrado.");
    }

    const order = snapshot.data();
    const currentStatus = order.status;
    if (!Object.prototype.hasOwnProperty.call(STATUS_LABELS, currentStatus)) {
      logger.error("Invalid stored order status", { orderId });
      fail("failed-precondition", "O status atual do pedido é inválido.");
    }

    if (currentStatus === nextStatus) {
      return {
        orderId,
        code: order.trackingCode,
        status: currentStatus,
        statusLabel: STATUS_LABELS[currentStatus],
        updatedAt: toIso(order.statusUpdatedAt ?? order.updatedAt)
      };
    }

    if (!ALLOWED_STATUS_TRANSITIONS[currentStatus].has(nextStatus)) {
      fail("failed-precondition", "Esta mudança de status não é permitida.");
    }

    const updatedAt = Timestamp.now();
    const history = Array.isArray(order.statusHistory) ? order.statusHistory.slice(-19) : [];
    history.push({
      status: nextStatus,
      at: updatedAt,
      actor: "manager",
      actorUid: managerUid,
      ...(note ? { note } : {})
    });

    transaction.update(orderRef, {
      status: nextStatus,
      statusUpdatedAt: updatedAt,
      statusHistory: history,
      updatedAt,
      updatedBy: managerUid
    });

    logger.info("Order status updated", { orderId, status: nextStatus, managerUid });
    return {
      orderId,
      code: order.trackingCode,
      status: nextStatus,
      statusLabel: STATUS_LABELS[nextStatus],
      updatedAt: updatedAt.toDate().toISOString()
    };
  });
});
