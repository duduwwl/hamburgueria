"use strict";

/*
 * Explicit, local-only manager bootstrap.
 * Create the user first in Firebase Authentication, then run this script with
 * a service-account file outside the repository. It never runs on deploy.
 */

const fs = require("fs");
const path = require("path");
const { applicationDefault, cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "hamburgueria-ee939";
const CONFIRM_VALUE = "hamburgueria-ee939";

function credentialFromEnvironment() {
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
  const email = String(process.env.MANAGER_EMAIL || "").trim().toLowerCase();
  if (PROJECT_ID !== CONFIRM_VALUE || process.env.CONFIRM_MANAGER !== CONFIRM_VALUE) {
    throw new Error(`Ação bloqueada. Defina CONFIRM_MANAGER=${CONFIRM_VALUE} para confirmar.`);
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error("Defina MANAGER_EMAIL com o e-mail de um usuário já criado no Firebase Authentication.");
  }

  if (!getApps().length) {
    initializeApp({ projectId: PROJECT_ID, credential: credentialFromEnvironment() });
  }

  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, {
    ...(user.customClaims || {}),
    manager: true
  });

  await getFirestore().collection("staff").doc(user.uid).set({
    email,
    role: "manager",
    active: true,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`Permissão de gerente atribuída a ${email}. A pessoa deve sair e entrar novamente para atualizar o token.`);
}

main().catch((error) => {
  console.error("Falha ao configurar gerente:", error.message);
  process.exitCode = 1;
});
