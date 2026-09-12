import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const config = defineCloudflareConfig();

// Privy's transitive dependencies currently advertise `workerd` export paths that are not
// present in their published packages. Use their browser/default exports instead; the app
// already reaches external services through fetch and Cloudflare supplies Node compatibility.
config.cloudflare = {
  ...config.cloudflare,
  useWorkerdCondition: false
};

export default config;
