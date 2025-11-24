// shared/modal.js
export function showModal(contentHtml) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-content">
      <button class="modal-close" onclick="document.body.removeChild(this.parentElement.parentElement)">×</button>
      ${contentHtml}
    </div>
  `;
  document.body.appendChild(overlay);
}
