// 1. Portfolio content and reusable labels.
// Add or edit work here; the gallery, search, and carousel read from this data.
const collections = {
  art: {
    label: "Art",
    description: "Illustrations, 3d, and sketches",
    items: [
      {
        id: "Mech-Battle",
        title: "Mech Battle",
        date: "Digital Illustration",
        mark: "01",
        image: "IMG_5065.jpg",
      },
      {
        id: "dragon-wall",
        title: "dragonWall",
        date: "Digital Illustration",
        mark: "12",
        image: "./Illustration12.png",
        featureImage: "./dragonWall-banner.png",
      },
      {
        id: "marching-band",
        title: "MarchingBand",
        date: "Blender Model",
        mark: "13",
        image: "./marching-band-main.png",
        gallery: [
          "./marching-band-sight.png",
          "./marching-band-standing.png",
          "./marching-band-hunt.png",
          "./marching-band-header.png",
        ],
      },
      {
        id: "armada",
        title: "Armada",
        date: "Digital Illustration",
        mark: "14",
        image: "./Illustration9990.png",
      },
      {
        id: "watch-dog",
        title: "watchDog",
        date: "Digital Illustration",
        mark: "15",
        image: "./Illustration10.png",
      },
    ],
  },
  comics: {
    label: "Comics",
    description: "WiP",
    items: [],
  },
  animations: {
    label: "Animations",
    description: "WiP",
    items: [],
  },
};

const categoryOrder = ["art", "comics", "animations"];
const categoryTranslations = {
  art: "藝術",
  comics: "漫畫",
  animations: "動畫",
};
const allWork = categoryOrder.flatMap((category) =>
  collections[category].items.map((item) => ({ ...item, category })),
);
const featuredWorks = allWork.filter((work) => work.image);

// 2. Shared site state and cached artwork.
// New banner images are decoded once so manual and timed cycling stay responsive.
const asciiHorizontal = "-".repeat(400);
// Keep the frame bars as one text node per side instead of many <br> elements.
const asciiVertical = "|\n".repeat(80);
const asciiFrameTemplate = document.createElement("template");
asciiFrameTemplate.innerHTML = `
  <span class="ascii-edge ascii-top">${asciiHorizontal}</span>
  <span class="ascii-corner ascii-top-left">/</span>
  <span class="ascii-side ascii-right">${asciiVertical}</span>
  <span class="ascii-edge ascii-bottom">${asciiHorizontal}</span>
  <span class="ascii-corner ascii-bottom-right">/</span>
  <span class="ascii-side ascii-left">${asciiVertical}</span>`;
const featureBanner = document.querySelector("#feature-banner");
const featureImage = document.querySelector("#feature-image");
const featureLink = document.querySelector("#feature-link");
const pageContent = document.querySelector("#page-content");
const siteNav = document.querySelector("#site-nav");
const copyWebsiteLink = document.querySelector("#copy-website-link");
const copyLinkStatus = document.querySelector("#copy-link-status");
const artSearch = document.querySelector(".art-search");
const artSearchInput = document.querySelector("#art-search-input");
const artSearchResults = document.querySelector("#art-search-results");
let activeFeature = 0;

const featuredImageCache = new Map([["./pfpalpha.png", featureImage]]);
let activeFeatureImage = featureImage;
for (const src of new Set(allWork.map((work) => work.featureImage ?? work.image).filter(Boolean))) {
  const image = new Image();
  image.className = "feature-image";
  image.fetchPriority = "high";
  image.decoding = "async";
  image.src = src;
  image.hidden = true;
  featureBanner.append(image);
  image.decode().catch((error) => {
    console.error(`Unable to decode featured image "${src}".`, error);
  });
  featuredImageCache.set(src, image);
}

function renderAsciiFrame() {
  return `<span class="ascii-frame" aria-hidden="true"></span>`;
}

function fillEmptyAsciiFrames(root = document) {
  root.querySelectorAll(".ascii-frame:empty").forEach((frame) => {
    frame.replaceChildren(asciiFrameTemplate.content.cloneNode(true));
  });
}

// 3. Route parsing and page rendering.
function getRoute() {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);

  if (parts.length === 0 || parts[0] === "home" || parts[0] === "featured") {
    return { page: "home" };
  }
  if (parts[0] === "about") {
    return { page: "about" };
  }
  if (categoryOrder.includes(parts[0])) {
    return parts[1]
      ? { page: "detail", category: parts[0], id: parts[1] }
      : { page: parts[0] };
  }
  return { page: "home" };
}

function makeNavLink(label, href, options = {}) {
  const current = options.current ? ' aria-current="page"' : "";
  const className = options.home ? "nav-button home-button" : "nav-button";
  return `
    <a class="${className}" href="${href}"${current}>
      <span class="nav-bracket nav-bracket-open" aria-hidden="true">[</span>
      <span class="nav-selected-marker" aria-hidden="true">*</span>
      <span class="nav-label">${label}</span>
      <span class="nav-bracket nav-bracket-close" aria-hidden="true">]</span>
    </a>`;
}

function renderNav(route) {
  const category = route.page === "detail" ? route.category : route.page;
  const links = [
    makeNavLink("Featured / 精選", "#featured", {
      home: true,
      current: route.page === "home",
    }),
  ];

  for (const key of categoryOrder) {
    links.push(makeNavLink(
      `${collections[key].label} / ${categoryTranslations[key]}`,
      `#${key}`,
      { current: key === category },
    ));
  }

  siteNav.innerHTML = links.join("");
}

function renderCard(item) {
  const detailHref = `#${item.category}/${item.id}`;
  const artwork = `
      <img
        class="work-art-image"
        src="${item.image}"
        alt="${item.title}"
        loading="lazy"
        decoding="async"
      >`;

  return `
    <article class="work-card">
      <a class="work-card-link" href="${detailHref}" aria-label="View ${item.title}">
        <div class="art-placeholder">
          ${artwork}
          ${renderAsciiFrame()}
        </div>
        <div class="card-copy">
          <h3 class="card-title">${item.title}</h3>
          <span class="card-meta">${item.date}</span>
        </div>
      </a>
    </article>`;
}

function renderHome() {
  const recentWork = allWork.slice(0, 3);
  return `
    <section class="page-section">
      <div class="section-heading">
        <div>
          <p class="section-overline">// 最新作品</p>
          <h2>Recent work / 最近作品</h2>
        </div>
        <a class="text-link" href="#art">Explore the collections ↗</a>
      </div>
      <div class="work-grid">${recentWork.map(renderCard).join("")}</div>
    </section>
  `;
}

function renderCollection(category) {
  const collection = collections[category];
  return `
    <section class="page-section">
      <div class="section-heading">
        <div>
          <p class="section-overline">${collection.items.length ? `// 收藏 · 作品 ${collection.items.length}` : "WiP"}</p>
          <h2>${collection.label} / ${categoryTranslations[category]}</h2>
          <p class="page-lede">${collection.description}</p>
        </div>
      </div>
      ${collection.items.length
        ? `<div class="work-grid">${collection.items
          .map((item) => renderCard({ ...item, category }))
          .join("")}</div>`
        : `<div class="collection-empty-art"><img src="./cat-surprised.gif" alt="A surprised cat looking through an opening"></div>`}
    </section>`;
}

function renderAbout() {
  return `
    <section class="page-section simple-page about-section">
      <p class="section-overline">//</p>
      <h2>About</h2>
      <div class="about-layout">
        <div class="artist-image-frame">
          <img class="artist-image" src="./pfpalpha.png" alt="Abstract artwork used as a temporary artist portrait">
          ${renderAsciiFrame()}
        </div>
        <div class="about-copy">
          <p><strong>BlindChicxulub;</strong>
          <br>Oh, Epics, Myths, and Legends.<br>
          ♓︎(雙魚座) 申猴.</p>
          <p>An artist destroys as much as he creates.</p>
          <a class="text-link patreon-link" href="https://www.patreon.com/c/BlindChicxulub" target="_blank" rel="noopener noreferrer">Patreon ↗  $$ :D</a>
        </div>
      </div>
    </section>`;
}

function renderDetail(route) {
  const collection = collections[route.category];
  const item = collection?.items.find((work) => work.id === route.id);

  if (!item) {
    return `<section class="page-section simple-page"><p class="section-overline">A missing page</p><h2>This work is not here yet.</h2><p class="page-lede"><a class="text-link" href="#${route.category}">Back to ${collection?.label ?? "the collection"} ↗</a></p></section>`;
  }

  const galleryImages = [item.image, ...(item.gallery ?? [])].filter(Boolean);
  const artwork = galleryImages.length > 1
    ? `
      <div class="detail-gallery" role="group" aria-label="${item.title} image gallery">
        <div class="art-placeholder detail-art">
          <img class="work-art-image" data-gallery-main-image src="${galleryImages[0]}" alt="${item.title}, image 1">
        </div>
        <div class="detail-thumbnails" role="group" aria-label="Select an image">
          ${galleryImages.map((src, index) => `
            <button
              class="detail-thumbnail${index === 0 ? " is-selected" : ""}"
              type="button"
              data-gallery-src="${src}"
              data-gallery-alt="${item.title}, image ${index + 1}"
              aria-label="Show image ${index + 1} of ${item.title}"
              aria-pressed="${index === 0}"
            >
              <img src="${src}" alt="" loading="lazy" decoding="async">
              ${renderAsciiFrame()}
            </button>`).join("")}
        </div>
      </div>`
    : `
      <div class="art-placeholder detail-art">
        <img class="work-art-image" src="${item.image}" alt="">
      </div>`;

  return `
    <section class="page-section detail-page">
      <a class="detail-back" href="#${route.category}"><span aria-hidden="true">←</span> Back to ${collection.label}</a>
      <div class="detail-heading">
        <div>
          <p class="section-overline">${collection.label} · ${item.date}</p>
          <h2>${item.title}</h2>
        </div>
        <span class="detail-meta">Work ${item.mark}</span>
      </div>
      ${artwork}
      <p class="detail-note">A featured artwork from the studio.</p>
    </section>`;
}

// 4. Search results are built as DOM nodes to keep user input out of HTML strings.
function renderSearchResults() {
  const query = artSearchInput.value.trim().toLocaleLowerCase();
  artSearchResults.replaceChildren();

  if (!query) {
    closeSearchResults();
    return;
  }

  const matches = allWork.filter((item) => {
    const searchableText = `${item.title} ${item.date} ${collections[item.category].label}`.toLocaleLowerCase();
    return searchableText.includes(query);
  });

  if (matches.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "search-empty";
    emptyMessage.textContent = "No matching work / 找不到作品";
    artSearchResults.append(emptyMessage);
  } else {
    const list = document.createElement("ul");
    list.className = "search-result-list";

    for (const item of matches) {
      const listItem = document.createElement("li");
      const link = document.createElement("a");
      const title = document.createElement("span");
      const category = document.createElement("span");

      link.className = "search-result";
      link.href = `#${item.category}/${item.id}`;
      title.className = "search-result-title";
      title.textContent = item.title;
      category.className = "search-result-category";
      category.textContent = collections[item.category].label;
      link.append(title, category);
      listItem.append(link);
      list.append(listItem);
    }

    artSearchResults.append(list);
  }

  artSearchResults.insertAdjacentHTML("beforeend", renderAsciiFrame());
  fillEmptyAsciiFrames(artSearchResults);
  artSearchResults.hidden = false;
  artSearchInput.setAttribute("aria-expanded", "true");
}

function closeSearchResults() {
  artSearchResults.hidden = true;
  artSearchInput.setAttribute("aria-expanded", "false");
}

// 5. Featured carousel updates only the cached image visibility and destination.
function renderFeature() {
  const work = featuredWorks[activeFeature];
  const imageSrc = work.featureImage ?? work.image ?? "./pfpalpha.png";
  featureBanner.dataset.category = work.category;
  featureBanner.dataset.artwork = work.id;
  const image = featuredImageCache.get(imageSrc);
  activeFeatureImage.hidden = true;
  image.hidden = false;
  activeFeatureImage = image;
  image.style.objectPosition = imageSrc === "./pfpalpha.png"
    ? "50% 17%"
    : work.id === "marching-band"
      ? "50% 35%"
      : "";
  featureLink.href = `#${work.category}/${work.id}`;
  featureLink.setAttribute("aria-label", `View ${work.title} in ${collections[work.category].label}`);
}

function renderPage() {
  const route = getRoute();
  renderNav(route);

  let content;
  if (route.page === "home") {
    content = renderHome();
  } else if (route.page === "detail") {
    content = renderDetail(route);
  } else if (route.page === "about") {
    content = renderAbout();
  } else {
    content = renderCollection(route.page);
  }

  if (route.page !== "about") {
    content += renderAbout();
  }
  pageContent.innerHTML = content;
  fillEmptyAsciiFrames(pageContent);
  updatePillarLength();
}

function changeFeature(direction) {
  activeFeature = (activeFeature + direction + featuredWorks.length) % featuredWorks.length;
  renderFeature();
}

pageContent.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const galleryButton = event.target.closest(".detail-thumbnail");
  if (galleryButton) {
    const gallery = galleryButton.closest(".detail-gallery");
    const mainImage = gallery?.querySelector("[data-gallery-main-image]");
    const imageSrc = galleryButton.dataset.gallerySrc;
    const imageAlt = galleryButton.dataset.galleryAlt;
    if (!(mainImage instanceof HTMLImageElement) || !imageSrc || !imageAlt) {
      return;
    }

    mainImage.src = imageSrc;
    mainImage.alt = imageAlt;
    gallery.querySelectorAll(".detail-thumbnail").forEach((button) => {
      const selected = button === galleryButton;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    return;
  }
});

// 7. Search, carousel, and page-level event handlers.
artSearch.addEventListener("submit", (event) => {
  event.preventDefault();
  const firstResult = artSearchResults.querySelector(".search-result");
  if (firstResult) {
    window.location.hash = firstResult.getAttribute("href");
    closeSearchResults();
  } else {
    renderSearchResults();
  }
});

artSearchInput.addEventListener("input", renderSearchResults);
artSearchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    artSearchResults.hidden = true;
    artSearchInput.setAttribute("aria-expanded", "false");
  }
});

artSearchResults.addEventListener("click", (event) => {
  if (event.target.closest(".search-result")) {
    closeSearchResults();
  }
});

document.addEventListener("click", (event) => {
  if (!artSearch.contains(event.target)) {
    closeSearchResults();
  }
});

for (const [selector, direction] of [["#feature-prev", -1], ["#feature-next", 1]]) {
  const button = document.querySelector(selector);
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    changeFeature(direction);
  });
  button.addEventListener("click", (event) => {
    if (event.detail === 0) {
      changeFeature(direction);
    }
  });
}

window.setInterval(() => {
  if (!document.hidden && !featureBanner.matches(":hover")) {
    changeFeature(1);
  }
}, 8000);

window.addEventListener("hashchange", renderPage);

copyWebsiteLink.addEventListener("click", async () => {
  const wordmarkName = copyWebsiteLink.querySelector(".wordmark-name");
  wordmarkName.classList.remove("is-jiggling");
  void wordmarkName.offsetWidth;
  wordmarkName.classList.add("is-jiggling");

  const websiteUrl = new URL(window.location.href);
  websiteUrl.hash = "";

  try {
    await navigator.clipboard.writeText(websiteUrl.href);
    copyLinkStatus.textContent = "Website link copied.";
  } catch (error) {
    copyLinkStatus.textContent = "Unable to copy website link.";
    console.error("Unable to copy website link.", error);
  }
});

const astroPillar = document.querySelector(".astro-pillar");
const pillarShaft = astroPillar.querySelector(".pillar-shaft");
const pillarRowTemplate = pillarShaft.querySelector(".pillar-row");
const pillarSpine = pillarShaft.querySelector(".pillar-blue-spine");
const pillarSpinePattern = pillarSpine.textContent;
const compassReading = document.querySelector("#compass-reading");
let scrollFrame = 0;

function updatePillarLength() {
  const footer = document.querySelector(".site-footer");
  if (!footer) {
    return;
  }

  const cap = astroPillar.querySelector(".pillar-cap");
  const base = astroPillar.querySelector(".pillar-base");
  const capStyle = getComputedStyle(cap);
  const baseStyle = getComputedStyle(base);
  const rowStyle = getComputedStyle(pillarRowTemplate);
  const footerTop = footer.getBoundingClientRect().top + window.scrollY;
  const pillarHeight = footerTop - astroPillar.offsetTop - 12;
  const shaftHeight = pillarHeight
    - cap.getBoundingClientRect().height
    - parseFloat(capStyle.marginBottom)
    - base.getBoundingClientRect().height
    - parseFloat(baseStyle.marginTop);
  const rowStride = pillarRowTemplate.getBoundingClientRect().height + parseFloat(rowStyle.marginBottom);
  const rowCount = Math.max(1, Math.floor(shaftHeight / rowStride));
  let rows = pillarShaft.querySelectorAll(".pillar-row");

  while (rows.length < rowCount) {
    pillarShaft.append(pillarRowTemplate.cloneNode(true));
    rows = pillarShaft.querySelectorAll(".pillar-row");
  }

  while (rows.length > rowCount) {
    rows[rows.length - 1].remove();
    rows = pillarShaft.querySelectorAll(".pillar-row");
  }

  const lastRow = rows[rows.length - 1];
  const rowMargin = parseFloat(rowStyle.marginBottom);
  lastRow.style.marginBottom = `${rowMargin}px`;
  const footerGap = footerTop - astroPillar.offsetTop - astroPillar.offsetHeight;
  lastRow.style.marginBottom = `${rowMargin + footerGap - 12}px`;

  const lineHeight = parseFloat(getComputedStyle(pillarSpine).lineHeight);
  const characterCount = Math.ceil(shaftHeight / lineHeight) + 8;
  pillarSpine.textContent = pillarSpinePattern.repeat(
    Math.ceil(characterCount / pillarSpinePattern.length),
  );
}

function updateAmbientScroll() {
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const scrollProgress = Math.min(1, window.scrollY / maxScroll);
  const bearing = Math.round(scrollProgress * 359);
  astroPillar.style.setProperty("--scroll-offset", `${-window.scrollY * 0.5}px`);
  compassReading.textContent = `${String(bearing).padStart(3, "0")}°`;
}

window.addEventListener("scroll", () => {
  if (scrollFrame) {
    return;
  }

  scrollFrame = window.requestAnimationFrame(() => {
    updateAmbientScroll();
    scrollFrame = 0;
  });
}, { passive: true });

window.addEventListener("resize", updatePillarLength);
window.addEventListener("load", updatePillarLength, { once: true });
pageContent.addEventListener("load", updatePillarLength, true);

updateAmbientScroll();
renderFeature();
renderPage();
fillEmptyAsciiFrames();
