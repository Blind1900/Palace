const collections = {
  art: {
    label: "Art",
    description: "Illustrations, experiments, and small worlds in still frames.",
    items: [
      { id: "amber-study", title: "A study in amber", date: "New work", mark: "01" },
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
const allWork = categoryOrder.flatMap((category) =>
  collections[category].items.map((item) => ({ ...item, category })),
);
const featureBanner = document.querySelector("#feature-banner");
const featureLink = document.querySelector("#feature-link");
const pageContent = document.querySelector("#page-content");
const siteNav = document.querySelector("#site-nav");
const artSearch = document.querySelector(".art-search");
const artSearchInput = document.querySelector("#art-search-input");
const artSearchResults = document.querySelector("#art-search-results");
let activeFeature = 0;

function getRoute() {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);

  if (parts.length === 0 || parts[0] === "home") {
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
  return `<a class="${className}" href="${href}"${current}>${label}</a>`;
}

function renderNav(route) {
  const category = route.page === "detail" ? route.category : route.page;
  const links = [
    makeNavLink("Featured / 精選", "#home", { home: true, current: route.page === "home" }),
  ];

  for (const key of categoryOrder) {
    const translations = { art: "藝術", comics: "漫畫", animations: "動畫" };
    links.push(makeNavLink(
      `${collections[key].label} / ${translations[key]}`,
      `#${key}`,
      { current: key === category },
    ));
  }

  links.push(makeNavLink("About / 關於", "#about", { current: route.page === "about" }));

  siteNav.innerHTML = links.join("");
}

function renderCard(item) {
  return `
    <article class="work-card">
      <a class="work-card-link" href="#${item.category}/${item.id}" aria-label="View ${item.title}">
        <div class="art-placeholder" role="img" aria-label="Artwork placeholder for ${item.title}">
          <span class="placeholder-label"><span>${item.mark}</span>Artwork placeholder</span>
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
    </section>`;
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
      <div class="work-grid">${collection.items.map((item) => renderCard({ ...item, category })).join("")}</div>
    </section>`;
}

function renderAbout() {
  return `
    <section class="page-section simple-page">
      <p class="section-overline">A note from the artist</p>
      <h2>Welcome to my little corner of the world.</h2>
      <div class="about-layout">
        <img class="artist-image" src="./pfpalpha.png" alt="Abstract artwork used as a temporary artist portrait">
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
      <div class="art-placeholder detail-art" role="img" aria-label="Large artwork placeholder for ${item.title}">
        <span class="placeholder-label"><span>${item.mark}</span>Replace this box with your artwork</span>
      </div>
      <p class="detail-note">This is a large placeholder for the full artwork. Add a caption, story notes, or credits here.</p>
    </section>`;
}

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

  artSearchResults.hidden = false;
  artSearchInput.setAttribute("aria-expanded", "true");
}

function renderFeature() {
  const work = allWork[activeFeature];
  featureBanner.dataset.category = work.category;
  featureBanner.style.setProperty("--art-position", `${35 + (activeFeature % 5) * 10}%`);
  featureLink.href = `#${work.category}/${work.id}`;
  featureLink.setAttribute("aria-label", `View ${work.title} in ${collections[work.category].label}`);
}

function renderPage() {
  const route = getRoute();
  renderNav(route);

  if (route.page === "home") {
    pageContent.innerHTML = renderHome();
  } else if (route.page === "detail") {
    pageContent.innerHTML = renderDetail(route);
  } else if (route.page === "about") {
    pageContent.innerHTML = renderAbout();
  } else if (route.page === "contact") {
    pageContent.innerHTML = renderContact();
  } else {
    pageContent.innerHTML = renderCollection(route.page);
  }
}

function changeFeature(direction) {
  activeFeature = (activeFeature + direction + allWork.length) % allWork.length;
  renderFeature();
}

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

document.querySelector("#feature-prev").addEventListener("click", () => changeFeature(-1));
document.querySelector("#feature-next").addEventListener("click", () => changeFeature(1));
window.addEventListener("hashchange", renderPage);

renderFeature();
renderPage();
