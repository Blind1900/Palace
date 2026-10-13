// 1. Portfolio content and reusable labels.
// Add or edit work here; the gallery, search, and carousel read from this data.
const collections = {
  art: {
    label: "Art",
    description: "Illustrations, experiments, and small worlds in still frames.",
    items: [
      {
        id: "horizon-ashes",
        title: "Ashes on the horizon",
        date: "New work",
        mark: "01",
        image: "./ashes-on-the-horizon.jpg",
      },
      { id: "quiet-garden", title: "The quiet garden", date: "Sketchbook", mark: "02" },
      { id: "night-window", title: "Window after dark", date: "Illustration", mark: "03" },
    ],
  },
  comics: {
    label: "Comics",
    description: "Sequential stories, one panel and one page at a time.",
    items: [
      { id: "small-hours", title: "At the small hours", date: "Chapter 01", mark: "04" },
      { id: "strange-familiar", title: "A strange familiar", date: "Short story", mark: "05" },
      { id: "palace-gardens", title: "The palace gardens", date: "In progress", mark: "06" },
    ],
  },
  animations: {
    label: "Animations",
    description: "Loops, moving sketches, and other things that won't sit still.",
    items: [
      { id: "slow-orbit", title: "A slow orbit", date: "Motion study", mark: "07" },
      { id: "paper-moon", title: "Paper moon", date: "Loop", mark: "08" },
      { id: "almost-dancing", title: "Almost dancing", date: "Test animation", mark: "09" },
    ],
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
const fallbackFeature = allWork.find((work) => !work.image);
const featuredWorks = [
  ...(fallbackFeature ? [fallbackFeature] : []),
  ...allWork.filter((work) => work.image),
];

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
const artSearch = document.querySelector(".art-search");
const artSearchInput = document.querySelector("#art-search-input");
const artSearchResults = document.querySelector("#art-search-results");
let activeFeature = 0;
let rangeGameInterval = null;
let rangeGameScore = 0;
let rangeGameSeconds = 30;
let rangeTargetIndex = -1;

const rangeTargetPositions = [
  { left: "26%", top: "38%", glyph: "申" },
  { left: "72%", top: "32%", glyph: "雙" },
  { left: "48%", top: "58%", glyph: "魚" },
  { left: "34%", top: "72%", glyph: "猴" },
  { left: "63%", top: "49%", glyph: "希" },
  { left: "79%", top: "68%", glyph: "克" },
  { left: "19%", top: "57%", glyph: "蘇" },
  { left: "54%", top: "28%", glyph: "伯" },
];

const featuredImageCache = new Map([["./pfpalpha.png", featureImage]]);
for (const src of new Set(allWork.map((work) => work.image).filter(Boolean))) {
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
  if (parts[0] === "about" || parts[0] === "contact") {
    return { page: parts[0] };
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
  const artwork = item.image
    ? `
      <img
        class="work-art-image"
        src="${item.image}"
        alt="${item.title}"
        loading="lazy"
        decoding="async"
      >`
    : `<span class="placeholder-label"><span>${item.mark}</span>Artwork placeholder</span>`;

  return `
    <article class="work-card">
      <a class="work-card-link" href="${detailHref}" aria-label="View ${item.title}">
        <div class="art-placeholder"${item.image ? "" : ` role="img" aria-label="Artwork placeholder for ${item.title}"`}>
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
    <section class="page-section range-game" aria-labelledby="range-title">
      <div class="section-heading">
        <div>
          <p class="section-overline">// Arcade · 遊戲</p>
          <h2 id="range-title">Celestial Range / 星界靶場</h2>
          <p class="page-lede">A first-person target game. Find the celestial glyphs and collect them before time runs out.</p>
        </div>
      </div>
      <div class="range-hud">
        <span>HITS <strong id="range-score">00</strong></span>
        <span>TIME <strong id="range-time">00:30</strong></span>
        <span id="range-status" role="status" aria-live="polite">Start a round when you are ready.</span>
      </div>
      <div class="range-scene" aria-label="First-person celestial target range">
        <span class="range-crosshair" aria-hidden="true">+</span>
        <button class="range-target" id="range-target" type="button" aria-label="Collect star target" hidden>申</button>
        ${renderAsciiFrame()}
      </div>
      <div class="range-controls">
        <button class="range-start nav-button" id="range-start" type="button">
          <span class="nav-bracket nav-bracket-open" aria-hidden="true">[</span>
          <span class="nav-label" id="range-start-label">Start / 開始</span>
          <span class="nav-bracket nav-bracket-close" aria-hidden="true">]</span>
        </button>
        <span>Click each glyph to collect it / 點擊字符收集</span>
      </div>
      <div class="range-tutorial">
        <h3>How to play / 遊戲方法</h3>
        <ol>
          <li>Select <strong>Start / 開始</strong> to begin a 30-second round.</li>
          <li>Click the Chinese-character target when it appears in the range.</li>
          <li>Collect as many glyphs as you can before the timer reaches zero.</li>
        </ol>
      </div>
    </section>
  `;
}

function renderCollection(category) {
  const collection = collections[category];
  return `
    <section class="page-section">
      <div class="section-heading">
        <div>
          <p class="section-overline">// 收藏 · 作品 ${collection.items.length}</p>
          <h2>${collection.label} / ${{ art: "藝術", comics: "漫畫", animations: "動畫" }[category]}</h2>
          <p class="page-lede">${collection.description}</p>
        </div>
      </div>
      <div class="work-grid">${collection.items
        .map((item) => renderCard({ ...item, category }))
        .join("")}</div>
    </section>`;
}

function renderAbout() {
  return `
    <section class="page-section simple-page about-section">
      <p class="section-overline">A note from the artist</p>
      <h2>Welcome to my little corner of the world.</h2>
      <div class="about-layout">
        <div class="artist-image-frame">
          <img class="artist-image" src="./pfpalpha.png" alt="Abstract artwork used as a temporary artist portrait">
          ${renderAsciiFrame()}
        </div>
        <div class="about-copy">
          <p><strong>Your artist name goes here.</strong> I make art, comics, and animations inspired by the strange, the tender, and the things that linger after a story ends.</p>
          <p>This is your space to introduce yourself. Add a few lines about what you make, what inspires you, or what you are working on now. Replace the portrait with your own whenever you are ready.</p>
          <a class="text-link" href="#contact">Say hello ↗</a>
        </div>
      </div>
    </section>`;
}

function renderContact() {
  return `
    <section class="page-section simple-page">
      <p class="section-overline">Correspondence</p>
      <h2>Come say hello.</h2>
      <p class="page-lede">For commissions, collaborations, or just to talk about art, leave your preferred contact details here when you are ready to share them.</p>
      <p class="page-lede"><strong>Your email or social links go here.</strong><br>This is a placeholder for your contact information.</p>
    </section>`;
}

function renderDetail(route) {
  const collection = collections[route.category];
  const item = collection?.items.find((work) => work.id === route.id);

  if (!item) {
    return `<section class="page-section simple-page"><p class="section-overline">A missing page</p><h2>This work is not here yet.</h2><p class="page-lede"><a class="text-link" href="#${route.category}">Back to ${collection?.label ?? "the collection"} ↗</a></p></section>`;
  }

  return `
    <section class="page-section detail-page">
      <a class="detail-back" href="#${route.category}"><span aria-hidden="true">←</span> Back to ${collection.label}</a>
      <div class="detail-heading">
        <div>
          <p class="section-overline">${collection.label} · ${item.date}</p>
          <h2>${item.title}</h2>
        </div>
        <span class="detail-meta">Work ${item.mark} / 09</span>
      </div>
      <div class="art-placeholder detail-art" role="img" aria-label="${item.image ? "Artwork" : "Large artwork placeholder"} for ${item.title}">
        ${item.image
    ? `<img class="work-art-image" src="${item.image}" alt="">`
    : `<span class="placeholder-label"><span>${item.mark}</span>Replace this box with your artwork</span>`}
      </div>
      <p class="detail-note">${item.image ? "A featured artwork from the studio." : "This is a large placeholder for the full artwork. Add a caption, story notes, or credits here."}</p>
    </section>`;
}

// 4. Search results are built as DOM nodes to keep user input out of HTML strings.
function renderSearchResults() {
  const query = artSearchInput.value.trim().toLocaleLowerCase();
  artSearchResults.replaceChildren();

  if (!query) {
    artSearchResults.hidden = true;
    artSearchInput.setAttribute("aria-expanded", "false");
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

// 5. Featured carousel updates only the cached image visibility and destination.
function renderFeature() {
  const work = featuredWorks[activeFeature];
  const imageSrc = work.image ?? "./pfpalpha.png";
  featureBanner.dataset.category = work.category;
  for (const [src, image] of featuredImageCache) {
    image.hidden = src !== imageSrc;
  }
  const image = featuredImageCache.get(imageSrc);
  image.style.objectPosition = imageSrc === "./pfpalpha.png" ? "50% 17%" : "";
  featureLink.href = `#${work.category}/${work.id}`;
  featureLink.setAttribute("aria-label", `View ${work.title} in ${collections[work.category].label}`);
}

function renderPage() {
  const route = getRoute();
  renderNav(route);
  if (route.page !== "home" && rangeGameInterval !== null) {
    window.clearInterval(rangeGameInterval);
    rangeGameInterval = null;
  }

  let content;
  if (route.page === "home") {
    content = renderHome();
  } else if (route.page === "detail") {
    content = renderDetail(route);
  } else if (route.page === "about") {
    content = renderAbout();
  } else if (route.page === "contact") {
    content = renderContact();
  } else {
    content = renderCollection(route.page);
  }

  if (route.page !== "about") {
    content += renderAbout();
  }
  pageContent.innerHTML = content;
  fillEmptyAsciiFrames(pageContent);
}

function changeFeature(direction) {
  activeFeature = (activeFeature + direction + featuredWorks.length) % featuredWorks.length;
  renderFeature();
}

// 6. The optional range game keeps one timer and updates its existing controls.
function placeRangeTarget() {
  const target = pageContent.querySelector("#range-target");
  if (!target) {
    return;
  }

  rangeTargetIndex = (rangeTargetIndex + 1) % rangeTargetPositions.length;
  const position = rangeTargetPositions[rangeTargetIndex];
  target.style.left = position.left;
  target.style.top = position.top;
  target.textContent = position.glyph;
}

function startRangeGame() {
  const target = pageContent.querySelector("#range-target");
  const startLabel = pageContent.querySelector("#range-start-label");
  const status = pageContent.querySelector("#range-status");
  const scoreDisplay = pageContent.querySelector("#range-score");
  const timeDisplay = pageContent.querySelector("#range-time");

  if (!target || !startLabel || !status || !scoreDisplay || !timeDisplay) {
    return;
  }

  if (rangeGameInterval !== null) {
    window.clearInterval(rangeGameInterval);
  }

  rangeGameScore = 0;
  rangeGameSeconds = 30;
  rangeTargetIndex = -1;
  scoreDisplay.textContent = "00";
  timeDisplay.textContent = "00:30";
  status.textContent = "Round live · collect the glyphs.";
  startLabel.textContent = "Restart / 重來";
  target.hidden = false;
  placeRangeTarget();

  rangeGameInterval = window.setInterval(() => {
    rangeGameSeconds -= 1;
    timeDisplay.textContent = `00:${String(rangeGameSeconds).padStart(2, "0")}`;

    if (rangeGameSeconds <= 0) {
      window.clearInterval(rangeGameInterval);
      rangeGameInterval = null;
      target.hidden = true;
      status.textContent = `Round complete · ${rangeGameScore} glyphs collected.`;
      startLabel.textContent = "Play again / 再玩一次";
    }
  }, 1000);
}

pageContent.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  if (event.target.closest("#range-start")) {
    startRangeGame();
    return;
  }

  const target = event.target.closest("#range-target");
  if (!target || rangeGameInterval === null) {
    return;
  }

  rangeGameScore += 1;
  const scoreDisplay = pageContent.querySelector("#range-score");
  const status = pageContent.querySelector("#range-status");
  scoreDisplay.textContent = String(rangeGameScore).padStart(2, "0");
  status.textContent = "Glyph collected · find the next one.";
  placeRangeTarget();
});

// 7. Search, carousel, and page-level event handlers.
artSearch.addEventListener("submit", (event) => {
  event.preventDefault();
  const firstResult = artSearchResults.querySelector(".search-result");
  if (firstResult) {
    window.location.hash = firstResult.getAttribute("href");
    artSearchResults.hidden = true;
    artSearchInput.setAttribute("aria-expanded", "false");
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
    artSearchResults.hidden = true;
    artSearchInput.setAttribute("aria-expanded", "false");
  }
});

document.addEventListener("click", (event) => {
  if (!artSearch.contains(event.target)) {
    artSearchResults.hidden = true;
    artSearchInput.setAttribute("aria-expanded", "false");
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

const astroPillar = document.querySelector(".astro-pillar");
let scrollFrame = 0;

window.addEventListener("scroll", () => {
  if (scrollFrame) {
    return;
  }

  scrollFrame = window.requestAnimationFrame(() => {
    astroPillar.style.setProperty("--scroll-offset", `${-window.scrollY * 0.5}px`);
    scrollFrame = 0;
  });
}, { passive: true });

renderFeature();
renderPage();
fillEmptyAsciiFrames();
