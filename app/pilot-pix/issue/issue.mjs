// Presentation only: no HTTP calls, Google SDK, payment state, secret or storage access.
const details=document.getElementById('details');
const content=document.getElementById('detail-text');
if(details&&content)details.addEventListener('click',()=>{
  const next=details.getAttribute('aria-expanded')!=='true';
  details.setAttribute('aria-expanded',String(next));
  content.hidden=!next;
  details.textContent=next?'Ocultar controles de segurança':'Ver controles de segurança';
});
