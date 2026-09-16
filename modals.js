/* Custom confirm/alert dialogs (native confirm()/alert() are blocked
   inside sandboxed iframe previews). Depends on t() from app.js. */
/* ============ Confirm / alert (custom, non-blocking) ============ */
/* Native confirm()/alert() are silently blocked in sandboxed iframe
   previews (they just return false immediately), which made the
   unit-delete confirmation always cancel itself. These render a small
   in-page dialog instead, so they work in any environment. */
function ensureModalRoot(){
  let el = document.getElementById('modalRoot');
  if(!el){ el = document.createElement('div'); el.id='modalRoot'; document.body.appendChild(el); }
  return el;
}
function showConfirm(message){
  return new Promise(resolve=>{
    const root = ensureModalRoot();
    root.innerHTML = `<div class="modal-overlay"><div class="modal-box">
      <div class="modal-msg">${message}</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="modalCancelBtn">${t('cancel')}</button>
        <button class="btn btn-danger" id="modalOkBtn">${t('delete')}</button>
      </div></div></div>`;
    document.getElementById('modalOkBtn').onclick = ()=>{ root.innerHTML=''; resolve(true); };
    document.getElementById('modalCancelBtn').onclick = ()=>{ root.innerHTML=''; resolve(false); };
  });
}
function showAlert(message){
  return new Promise(resolve=>{
    const root = ensureModalRoot();
    root.innerHTML = `<div class="modal-overlay"><div class="modal-box">
      <div class="modal-msg">${message}</div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="modalAlertOkBtn">OK</button>
      </div></div></div>`;
    document.getElementById('modalAlertOkBtn').onclick = ()=>{ root.innerHTML=''; resolve(); };
  });
}
