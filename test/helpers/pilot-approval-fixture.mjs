import crypto from 'node:crypto';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
export const NOW=Date.UTC(2026,9,20,15);
export function approvalFile(now=NOW,id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'){
  const h=hash('ESCUDO_FIT_PILOT_REQUEST_KEY_V1|'+id).slice(0,32).split('');
  h[12]='4';h[16]=((parseInt(h[16],16)&3)|8).toString(16);const key=h.join('');
  const requestKey=[key.slice(0,8),key.slice(8,12),key.slice(12,16),key.slice(16,20),key.slice(20)].join('-');
  return {schemaVersion:1,approvalId:id,scope:'FIRST_LIVE_PIX_SINGLE_ORDER',state:'APPROVED_SINGLE_PILOT',
    approvedBySubjectHash:'6b3b55088d7a4f1ccd0323121f5c01029d6e1be9a566850e5e6bb2c0838c4bbb',
    subjectHash:hash('synthetic-buyer'),bindingDigest:hash('synthetic-binding'),requestKeyHash:hash(requestKey),
    receiverAccountId:'13926970',maxAmountBRL:'4.99',currency:'BRL',maxOrders:1,planKey:'monthly',
    channel:'WEB_OFFICIAL_DIRECT',termsVersion:'prepaid-v1-2026-10-16',issuedAtMs:now,expiresAtMs:now+1800000,
    // Encoding-only fixture: deliberately NOT a real Ed25519 signature.
    operatorSignature:'A'.repeat(86)};
}
export function approvalChallenge(now=NOW){return {state:'CHALLENGE',purpose:'ESCUDO_FIT_SIGNED_APPROVAL_INSTALL_V1',
  challengeId:'C'.repeat(43),buyerNonce:'ef-install-buyer-v1-'+'B'.repeat(43),
  operatorNonce:'ef-install-operator-v1-'+'O'.repeat(43),expiresAtMs:now+299000,
  financialGo:false,approvalCreated:false,orderCreated:false,premiumGranted:false};}
export function approvalReceipt(record=approvalFile()){
  const r=record,scopeDigest=hash(JSON.stringify(['ESCUDO_FIT_FIRST_LIVE_APPROVAL_V1','escudo-fitclima',
    'escudo-fit-payments-commercial',r.schemaVersion,r.approvalId,r.scope,r.approvedBySubjectHash,r.subjectHash,
    r.bindingDigest,r.requestKeyHash,r.receiverAccountId,r.maxAmountBRL,r.currency,r.maxOrders,r.planKey,
    r.channel,r.termsVersion,r.issuedAtMs,r.expiresAtMs]));
  return {state:'SIGNED_APPROVAL_REGISTERED_NO_ORDER',purpose:'ESCUDO_FIT_SIGNED_APPROVAL_INSTALL_V1',
    approvalId:r.approvalId,scopeDigest,approvalCreated:true,approvalRegistered:true,
    googleSignaturesVerified:true,noncesVerified:true,freshIdentitiesVerified:true,identitiesDistinct:true,
    challengeConsumed:true,financialGo:false,orderCreated:false,premiumGranted:false};
}
