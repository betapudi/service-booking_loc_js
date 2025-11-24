// shared/ui.js
export function showToast(message, type = "info", duration = 3000) {
  if (typeof Swal !== "undefined") {
    Swal.fire({
      toast: true,
      position: "top-end",
      icon: type,
      title: message,
      showConfirmButton: false,
      timer: duration
    });
  } else {
    alert(`${type.toUpperCase()}: ${message}`);
  }
}

export function showNotification(message, type = 'info') {
  if (window.Swal) {
    const Toast = Swal.mixin({
      toast: true,
      position: 'bottom',
      showConfirmButton: false,
      timer: 2000,
      timerProgressBar: true,
      background: '#2563eb',
      color: '#fff',
      customClass: {
        popup: 'custom-toast-position'
      },
      didOpen: (popup) => {
        popup.style.borderRadius = '10px';
        popup.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      }
    });
    Toast.fire({
      icon: type,
      title: message
    });
  } else {
    alert(message);
  }
}

export function switchTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  document.querySelectorAll(".tab-content").forEach(tab => {
    tab.classList.toggle("active", tab.id === `${tabName}-tab`);
  });
}

export function setLoadingState(button, isLoading, loadingText = "Loading...") {
  if (!button) return;

  if (isLoading) {
    button.disabled = true;
    button.dataset.originalText = button.textContent;
    button.innerHTML = `<span class="spinner"></span> ${loadingText}`;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || "Submit";
  }
}
