/*
 * Public browser configuration.
 *
 * reCAPTCHA site keys identify the website and are safe to publish. Replace
 * the empty string only after registering this web app in Firebase App Check.
 * Never put a reCAPTCHA secret key, Firebase service-account JSON, Pix key,
 * password, token, or any other private credential in this file.
 */
window.NABRASA_RECAPTCHA_SITE_KEY = '';

/*
 * Modo temporário para testar somente a interface do painel de gerente.
 * Aceita qualquer e-mail e senha preenchidos, mas não concede acesso aos
 * pedidos reais do Firebase. Antes de publicar, altere para false.
 */
window.NABRASA_DEMO_MANAGER_MODE = true;
