import crypto from 'node:crypto';
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
export const PREVIEW_PURPOSE='ESCUDO_FIT_NONFINANCIAL_APPROVAL_PREVIEW_V1';
const zero={financialGo:false,approvalCreated:false,orderCreated:false,premiumGranted:false};
export const previewChallenge=(now=Date.now())=>({state:'CHALLENGE',purpose:PREVIEW_PURPOSE,
  challengeId:'a'.repeat(43),buyerNonce:'ef-preview-buyer-v1-'+'b'.repeat(43),
  operatorNonce:'ef-preview-operator-v1-'+'c'.repeat(43),expiresAtMs:now+240000,...zero});
export function previewProof(now=Date.now()){
  const approvalId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const h=sha('ESCUDO_FIT_PILOT_REQUEST_KEY_V1|'+approvalId).slice(0,32).split('');
  h[12]='4';h[16]=((parseInt(h[16],16)&3)|8).toString(16);const key=h.join('');
  const requestKey=`${key.slice(0,8)}-${key.slice(8,12)}-${key.slice(12,16)}-${key.slice(16,20)}-${key.slice(20)}`;
  const r={schemaVersion:1,approvalId,scope:'FIRST_LIVE_PIX_SINGLE_ORDER',state:'APPROVED_SINGLE_PILOT',
    approvedBySubjectHash:'6b3b55088d7a4f1ccd0323121f5c01029d6e1be9a566850e5e6bb2c0838c4bbb',
    subjectHash:'b'.repeat(64),bindingDigest:'c'.repeat(64),requestKeyHash:sha(requestKey),receiverAccountId:'13926970',
    maxAmountBRL:'4.99',currency:'BRL',maxOrders:1,planKey:'monthly',channel:'WEB_OFFICIAL_DIRECT',
    termsVersion:'prepaid-v1-2026-10-16',issuedAtMs:now,expiresAtMs:now+1800000};
  const payload=JSON.stringify(['ESCUDO_FIT_FIRST_LIVE_APPROVAL_V1','escudo-fitclima','escudo-fit-payments-commercial',
    r.schemaVersion,r.approvalId,r.scope,r.approvedBySubjectHash,r.subjectHash,r.bindingDigest,r.requestKeyHash,
    r.receiverAccountId,r.maxAmountBRL,r.currency,r.maxOrders,r.planKey,r.channel,r.termsVersion,r.issuedAtMs,r.expiresAtMs]);
  return {state:'UNSIGNED_APPROVAL_PROPOSAL',purpose:PREVIEW_PURPOSE,
    proposal:{schemaVersion:1,keyVersion:'projects/escudo-fitclima/locations/us-central1/keyRings/escudo-fit-approvals/cryptoKeys/first-live-pilot-operator/cryptoKeyVersions/1',
      keyFingerprint:'47a836a4284792962d0c3bd3ddcb55e6514a0a84b6e40c55a15e4db638210610',record:r},
    scopeDigest:sha(payload),googleSignaturesVerified:true,noncesVerified:true,identitiesDistinct:true,
    freshIdentitiesVerified:true,challengeConsumed:true,canonicalBuyerVerified:true,...zero};
}
