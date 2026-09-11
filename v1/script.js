// CONFIGURATION
const YOUTUBE_API_KEY = "YOUR_YOUTUBE_API_KEY_HERE";
const CHANNEL_ID = "UCwJgLHc-2ScDA0Ht1HMNhdA";
const TOTAL_FANART_COUNT = 100; // Scans from fanart1 to fanart100 in the main directory

// YOUTUBE FEED INTEGRATION
async function fetchYouTubeVideos() {
  const container = document.getElementById("tilesContainer");
  if (!container) return;

  if (YOUTUBE_API_KEY === "YOUR_YOUTUBE_API_KEY_HERE") {
    container.innerHTML = generateDemoTiles();
    return;
  }

  const url = `https://www.googleapis.com/youtube/v3/search?key=${YOUTUBE_API_KEY}&channelId=${CHANNEL_ID}&part=snippet,id&order=date&maxResults=20`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      container.innerHTML = "<p class='loading-state'>No videos found.</p>";
      return;
    }

    container.innerHTML = "";

    data.items.forEach(item => {
      let videoId = item.id ? item.id.videoId : null;
      if (!videoId) return;

      const title = item.snippet.title;
      const thumbnail = item.snippet.thumbnails.high.url;
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

      const card = document.createElement("a");
      card.href = videoUrl;
      card.target = "_blank";
      card.className = "switch-card";
      card.innerHTML = `
        <img src="${thumbnail}" alt="${title}">
        <div class="switch-card-title">${title}</div>
      `;
      container.appendChild(card);
    });

  } catch (error) {
    console.error("Error fetching YouTube feed:", error);
    container.innerHTML = "<p class='loading-state'>Error loading feed.</p>";
  }
}

function generateDemoTiles() {
  let html = "";
  for (let i = 1; i <= 10; i++) {
    html += `
      <a href="https://youtube.com" target="_blank" class="switch-card">
        <img src="https://picsum.photos/400/400?random=${i}" alt="Demo Video ${i}">
        <div class="switch-card-title">Recent Upload / Video #${i}</div>
      </a>
    `;
  }
  return html;
}

document.addEventListener("DOMContentLoaded", () => {
  // Initialize YouTube Feed
  fetchYouTubeVideos();

  // Navigation & Audio Elements
  const cardsViewport = document.getElementById("cardsViewport");
  const scrollLeftBtn = document.getElementById("scrollLeftBtn");
  const scrollRightBtn = document.getElementById("scrollRightBtn");
  const nextPageAudio = document.getElementById("nextPageAudio");

  // Play Page Click Sound Function
  const playClickSound = () => {
    if (nextPageAudio) {
      nextPageAudio.currentTime = 0;
      nextPageAudio.play().catch(() => {});
    }
  };

  // Carousel Arrows with Sound Effect
  if (scrollLeftBtn && cardsViewport) {
    scrollLeftBtn.addEventListener("click", () => {
      playClickSound();
      cardsViewport.scrollBy({ left: -320, behavior: "smooth" });
    });
  }

  if (scrollRightBtn && cardsViewport) {
    scrollRightBtn.addEventListener("click", () => {
      playClickSound();
      cardsViewport.scrollBy({ left: 320, behavior: "smooth" });
    });
  }

  // Bottom Dock Hover Labels
  const dockBtns = document.querySelectorAll(".dock-btn");
  const dockLabel = document.getElementById("dockLabel");
  dockBtns.forEach(btn => {
    btn.addEventListener("mouseenter", () => {
      const labelText = btn.getAttribute("data-label");
      if (dockLabel && labelText) dockLabel.innerText = labelText;
    });
  });

  // Modal Elements
  const emailModal = document.getElementById("emailModal");
  const fanartModal = document.getElementById("fanartModal");
  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightboxImg");

  const openEmailBtn = document.getElementById("openEmailBtn");
  const closeEmailModal = document.getElementById("closeEmailModal");
  const openFanartBtn = document.getElementById("openFanartBtn");
  const closeFanartModal = document.getElementById("closeFanartModal");
  const closeLightbox = document.getElementById("closeLightbox");
  const copyEmailBtn = document.getElementById("copyEmailBtn");

  if (openEmailBtn && emailModal) {
    openEmailBtn.addEventListener("click", () => {
      emailModal.style.display = "flex";
    });
  }

  if (closeEmailModal && emailModal) {
    closeEmailModal.addEventListener("click", () => {
      emailModal.style.display = "none";
    });
  }

  if (copyEmailBtn) {
    copyEmailBtn.addEventListener("click", () => {
      const email = document.getElementById("emailAddress")?.innerText || "";
      navigator.clipboard.writeText(email);
      alert("Email address copied!");
    });
  }

  // Dynamic Fanart Gallery Loading (Up to 100 images, auto-detects .jpg, .png, .jpeg, .webp)
  function loadFanartGallery() {
    const grid = document.getElementById("fanartGrid");
    if (!grid) return;

    grid.innerHTML = "";
    const extensions = [".jpg", ".png", ".jpeg", ".webp"];

    for (let i = 1; i <= TOTAL_FANART_COUNT; i++) {
      const img = document.createElement("img");
      img.alt = `Fanart ${i}`;

      let extIndex = 0;
      img.src = `fanart${i}${extensions[extIndex]}`;

      // Tries next extension if load fails; removes node if none exist
      img.onerror = function () {
        extIndex++;
        if (extIndex < extensions.length) {
          this.src = `fanart${i}${extensions[extIndex]}`;
        } else {
          this.remove();
        }
      };

      img.addEventListener("click", () => {
        if (lightboxImg && lightbox) {
          lightboxImg.src = img.src;
          lightbox.style.display = "flex";
        }
      });

      grid.appendChild(img);
    }
  }

  if (openFanartBtn && fanartModal) {
    openFanartBtn.addEventListener("click", () => {
      fanartModal.style.display = "flex";
      loadFanartGallery();
    });
  }

  if (closeFanartModal && fanartModal) {
    closeFanartModal.addEventListener("click", () => {
      fanartModal.style.display = "none";
    });
  }

  if (closeLightbox && lightbox) {
    closeLightbox.addEventListener("click", () => {
      lightbox.style.display = "none";
    });
  }

  // Close modals when clicking overlay
  window.addEventListener("click", (e) => {
    if (e.target === emailModal) emailModal.style.display = "none";
    if (e.target === fanartModal) fanartModal.style.display = "none";
    if (e.target === lightbox) lightbox.style.display = "none";
  });
});
