"use strict";

/*
 * Deliberately manual catalogue seed.
 *
 * This script never runs during deployment. It requires an explicit
 * CONFIRM_SEED value and a local service-account credential (or application
 * default credentials). Do not add a service-account JSON file to this repo.
 */

const fs = require("fs");
const path = require("path");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "hamburgueria-ee939";
const CONFIRM_VALUE = "hamburgueria-ee939";
const functionsNodeModules = path.resolve(__dirname, "..", "functions", "node_modules");
const { applicationDefault, cert, getApps, initializeApp } = require(path.join(functionsNodeModules, "firebase-admin/app"));
const { getFirestore, FieldValue } = require(path.join(functionsNodeModules, "firebase-admin/firestore"));

const products = [
  { id: "classic", category: "tradicionais", categoryLabel: "Tradicional", name: "Clássico da Brasa", description: "Burger bovino 120 g, cheddar, alface, tomate, picles e maionese da casa no brioche.", priceCents: 2690, image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=700&q=82" },
  { id: "bacon", category: "tradicionais", categoryLabel: "Tradicional", name: "X-Bacon da Casa", description: "Burger bovino 120 g, cheddar cremoso, bacon crocante, cebola roxa e molho especial.", priceCents: 2990, image: "https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=700&q=82" },
  { id: "salad", category: "tradicionais", categoryLabel: "Tradicional", name: "X-Salada Mineiro", description: "Burger bovino, queijo minas, alface, tomate, milho e maionese temperada.", priceCents: 2890, image: "https://images.unsplash.com/photo-1565299507177-b0ac66763828?auto=format&fit=crop&w=700&q=82" },
  { id: "executive-dish", category: "pratos", categoryLabel: "Prato", name: "Prato Executivo Na Brasa", description: "Frango grelhado, arroz, legumes e acompanhamento da casa.", priceCents: 2890, image: "https://images.unsplash.com/photo-1606756790138-261d2b21cd75?auto=format&fit=crop&w=700&q=82" },
  { id: "double", category: "tradicionais", categoryLabel: "Tradicional", name: "Duplo Na Brasa", description: "Dois burgers smash, cheddar em dobro, bacon e o molho da casa.", priceCents: 3490, image: "https://images.unsplash.com/photo-1586190848861-99aa4a171e90?auto=format&fit=crop&w=700&q=82" },
  { id: "mineirinho", category: "especiais", categoryLabel: "Especial", name: "Mineirinho Especial", description: "Burger 160 g, queijo minas grelhado, bacon, rúcula e geleia de pimenta.", priceCents: 3690, image: "https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=700&q=82" },
  { id: "bbq", category: "especiais", categoryLabel: "Especial", name: "Bruto Barbecue", description: "Burger 180 g, cheddar, bacon, onion rings e barbecue defumado.", priceCents: 3990, image: "https://images.unsplash.com/photo-1550317138-10000687a72b?auto=format&fit=crop&w=700&q=82" },
  { id: "rib", category: "especiais", categoryLabel: "Especial", name: "Costela Fire", description: "Blend de costela 160 g, provolone, cebola caramelizada e barbecue.", priceCents: 4190, image: "https://images.unsplash.com/photo-1594212699903-ec8a3eca50f5?auto=format&fit=crop&w=700&q=82" },
  { id: "spicy", category: "especiais", categoryLabel: "Especial", name: "Picante Na Brasa", description: "Burger 160 g, cheddar, bacon, jalapeño, cebola roxa e molho chipotle.", priceCents: 3790, image: "https://images.unsplash.com/photo-1596662951482-0c4ba74a6df6?auto=format&fit=crop&w=700&q=82" },
  { id: "honey", category: "especiais", categoryLabel: "Especial", name: "Chicken Honey Bacon", description: "Frango crocante, bacon, cheddar, coleslaw e molho de mel e mostarda.", priceCents: 3590, image: "https://images.unsplash.com/photo-1598182198871-d3f4ab4fd181?auto=format&fit=crop&w=700&q=82" },
  { id: "truffle", category: "artesanais", categoryLabel: "Artesanal", name: "Trufado do Chef", description: "Dois smash burgers, queijo prato, cebola caramelizada e maionese trufada.", priceCents: 4090, image: "https://images.unsplash.com/photo-1610970878459-a0e464d7592b?auto=format&fit=crop&w=700&q=82" },
  { id: "mushroom", category: "artesanais", categoryLabel: "Artesanal", name: "Cogumelo & Provolone", description: "Burger artesanal 180 g, cogumelos salteados, provolone e aioli de ervas.", priceCents: 4290, image: "https://images.unsplash.com/photo-1607013251379-e6eecfffe234?auto=format&fit=crop&w=700&q=82" },
  { id: "lamb", category: "artesanais", categoryLabel: "Artesanal", name: "Cordeiro da Serra", description: "Burger de cordeiro, queijo minas padrão, cebola roxa, hortelã e molho cítrico.", priceCents: 4590, image: "https://images.unsplash.com/photo-1615297928064-24977384d0da?auto=format&fit=crop&w=700&q=82" },
  { id: "fries-classic", category: "batatas", categoryLabel: "Batata", name: "Batata Frita Crocante", description: "Porção de 150 g de batata frita douradinha e crocante.", priceCents: 1290, image: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=700&q=82" },
  { id: "fries-cheddar", category: "batatas", categoryLabel: "Batata", name: "Batata Cheddar & Bacon", description: "Batata frita coberta com cheddar cremoso e bacon crocante.", priceCents: 1990, image: "https://images.unsplash.com/photo-1585109649139-366815a0d713?auto=format&fit=crop&w=700&q=82" },
  { id: "fries-family", category: "batatas", categoryLabel: "Batata", name: "Batata Família", description: "350 g de batata frita para dividir com a mesa toda.", priceCents: 2490, image: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=700&q=82" },
  { id: "coke-original", category: "refrigerantes", categoryLabel: "Refrigerante • 350 ml", brand: "Coca-Cola", name: "Coca-Cola Original", description: "Lata 350 ml, sabor original.", priceCents: 750, image: "assets/coca-cola-original.jpg" },
  { id: "coke-zero", category: "refrigerantes", categoryLabel: "Refrigerante • 350 ml", brand: "Coca-Cola", name: "Coca-Cola Sem Açúcar", description: "Lata 350 ml, zero açúcar.", priceCents: 750, image: "assets/coca-cola-sem-acucar.png" },
  { id: "guarana", category: "refrigerantes", categoryLabel: "Refrigerante • 350 ml", brand: "Guaraná Antarctica", name: "Guaraná Antarctica", description: "Lata 350 ml, original.", priceCents: 700, image: "assets/guarana-antarctica.jpg" },
  { id: "sprite", category: "refrigerantes", categoryLabel: "Refrigerante • 350 ml", brand: "Sprite", name: "Sprite", description: "Lata 350 ml, refrescante sabor limão.", priceCents: 700, image: "assets/sprite-lata.png" },
  { id: "pepsi-black", category: "refrigerantes", categoryLabel: "Refrigerante • 350 ml", brand: "Pepsi", name: "Pepsi Black", description: "Lata 350 ml, zero açúcar.", priceCents: 700, image: "assets/pepsi-black.png" },
  { id: "heineken", category: "cervejas", categoryLabel: "Cerveja • Long neck", brand: "Heineken", name: "Heineken Long Neck", description: "Cerveja lager, garrafa long neck 330 ml. Venda somente para maiores de 18 anos.", priceCents: 1290, alcohol: true, image: "assets/heineken-long-neck.jpg" },
  { id: "budweiser", category: "cervejas", categoryLabel: "Cerveja • Long neck", brand: "Budweiser", name: "Budweiser Long Neck", description: "American lager, garrafa long neck 330 ml. Venda somente para maiores de 18 anos.", priceCents: 1090, alcohol: true, image: "assets/budweiser-long-neck.jpg" },
  { id: "delvalle-grape", category: "sucos", categoryLabel: "Suco • 290 ml", brand: "Del Valle", name: "Del Valle Uva", description: "Suco de uva, lata 290 ml.", priceCents: 790, image: "https://andinacocacola.vtexassets.com/arquivos/ids/158622-800-auto?v=639094449084230000&width=800&height=auto&aspect=true" },
  { id: "delvalle-peach", category: "sucos", categoryLabel: "Suco • 290 ml", brand: "Del Valle", name: "Del Valle Pêssego", description: "Suco de pêssego, lata 290 ml.", priceCents: 790, image: "https://andinacocacola.vtexassets.com/arquivos/ids/158623-800-auto?v=639094449083930000&width=800&height=auto&aspect=true" },
  { id: "delvalle-passionfruit", category: "sucos", categoryLabel: "Suco • 290 ml", brand: "Del Valle", name: "Del Valle Maracujá", description: "Suco de maracujá, lata 290 ml.", priceCents: 790, image: "https://andinacocacola.vtexassets.com/arquivos/ids/158624-800-auto?v=639094449083930000&width=800&height=auto&aspect=true" },
  { id: "combo-classic", category: "combos", categoryLabel: "Combo", name: "Combo Clássico", description: "Clássico da Brasa + Batata Frita Crocante + Coca-Cola Original.", priceCents: 3990, image: "https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=700&q=82", kind: "combo" },
  { id: "combo-bacon", category: "combos", categoryLabel: "Combo", name: "Combo Bacon", description: "X-Bacon da Casa + Batata Cheddar & Bacon + Coca-Cola Sem Açúcar.", priceCents: 4990, image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=700&q=82", kind: "combo" },
  { id: "combo-duplo", category: "combos", categoryLabel: "Combo", name: "Combo Duplo", description: "Duplo Na Brasa + Batata Frita Crocante + Guaraná Antarctica.", priceCents: 4590, image: "https://images.unsplash.com/photo-1586190848861-99aa4a171e90?auto=format&fit=crop&w=700&q=82", kind: "combo" },
  { id: "promo-mineirinho", category: "promocoes", categoryLabel: "Oferta individual", name: "Mineirinho Especial", description: "Oferta individual do dia: de R$ 36,90 por R$ 31,90.", priceCents: 3190, image: "https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=700&q=82", kind: "promotion" }
];

const promotionIds = new Set(["combo-classic", "combo-bacon", "combo-duplo", "promo-mineirinho"]);

function getCredential() {
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!keyPath) {
    return applicationDefault();
  }

  const resolvedPath = path.resolve(keyPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT não aponta para um arquivo existente.");
  }
  return cert(JSON.parse(fs.readFileSync(resolvedPath, "utf8")));
}

async function main() {
  if (PROJECT_ID !== CONFIRM_VALUE) {
    throw new Error(`Projeto recusado: esperado ${CONFIRM_VALUE}.`);
  }
  if (process.env.CONFIRM_SEED !== CONFIRM_VALUE) {
    throw new Error(`Seed bloqueado. Defina CONFIRM_SEED=${CONFIRM_VALUE} para executar manualmente.`);
  }

  if (!getApps().length) {
    initializeApp({ projectId: PROJECT_ID, credential: getCredential() });
  }

  const db = getFirestore();
  const batch = db.batch();
  products.forEach((product, index) => {
    batch.set(db.collection("products").doc(product.id), {
      ...product,
      active: true,
      alcohol: product.alcohol === true,
      sortOrder: index + 1,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });

  products
    .filter((product) => promotionIds.has(product.id))
    .forEach((product, index) => {
      batch.set(db.collection("promotions").doc(product.id), {
        productId: product.id,
        category: product.category,
        categoryLabel: product.categoryLabel,
        name: product.name,
        description: product.description,
        priceCents: product.priceCents,
        image: product.image,
        active: true,
        sortOrder: index + 1,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });

  await batch.commit();
  console.log(`Catálogo gravado: ${products.length} produtos e ${promotionIds.size} promoções em ${PROJECT_ID}.`);
}

main().catch((error) => {
  console.error("Falha ao gravar o catálogo:", error.message);
  process.exitCode = 1;
});
