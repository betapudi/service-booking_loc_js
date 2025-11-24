// shared/rating.js
import { apiCall } from "./api.js";
import { showModal } from "./modal.js";
import { showToast } from "./ui.js";

export function openRatingModal(bookingId, providerId) {
  const stars = Array.from({ length: 5 }, (_, i) => `<span class="star" data-value="${i+1}">★</span>`).join("");
  const html = `
    <h3>Rate Your Service</h3>
    <div class="rating-stars">${stars}</div>
    <textarea id="feedbackText" class="input" placeholder="Leave feedback..."></textarea>
    <button class="btn" onclick="submitRating(${bookingId}, ${providerId})">Submit</button>
  `;
  showModal(html);

  document.querySelectorAll(".star").forEach(star => {
    star.addEventListener("click", () => {
      const val = parseInt(star.dataset.value);
      document.querySelectorAll(".star").forEach(s => {
        s.style.color = parseInt(s.dataset.value) <= val ? "#fbbf24" : "#d1d5db";
      });
      star.parentElement.dataset.rating = val;
    });
  });
}

window.submitRating = async function (bookingId, providerId) {
  const rating = document.querySelector(".rating-stars").dataset.rating;
  const feedback = document.getElementById("feedbackText").value;

  if (!rating) {
    showToast("Please select a rating", "warning");
    return;
  }

  const res = await apiCall("/feedback", {
    method: "POST",
    body: { booking_id: bookingId, provider_id: providerId, rating, feedback }
  });

  if (res.success) {
    showToast("Thank you for your feedback!", "success");
    document.querySelector(".modal-overlay")?.remove();
  } else {
    showToast("Failed to submit feedback", "error");
  }
};
