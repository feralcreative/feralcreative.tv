// Channel destinations. Add future channels to the HTML with a matching data-channel.
const TV_CHANNELS = {
  cats: { url: "https://cats.feralcreative.tv/", localHost: "cats.localhost" },
  montclair: { url: "https://montclair.tv/", localHost: "montclair.localhost" },
};

const TV_LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname.endsWith(".localhost");

for (const link of document.querySelectorAll("[data-channel]")) {
  const channel = TV_CHANNELS[link.dataset.channel];
  if (!channel) continue;
  const destination = new URL(channel.url);
  if (TV_LOCAL) {
    destination.protocol = location.protocol;
    destination.hostname = channel.localHost;
    destination.port = location.port;
  }
  link.href = destination.href;
}

for (const link of document.querySelectorAll("[data-tv-home]")) {
  link.href = TV_LOCAL ? `${location.protocol}//localhost${location.port ? ":" + location.port : ""}/` : "https://feralcreative.tv/";
}
