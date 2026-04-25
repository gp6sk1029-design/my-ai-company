import { onRequestPost as __api_detect_ingredients_js_onRequestPost } from "/Users/shoheikoda/Documents/my-ai-company/private/cooking-recipe/functions/api/detect-ingredients.js"
import { onRequestPost as __api_generate_js_onRequestPost } from "/Users/shoheikoda/Documents/my-ai-company/private/cooking-recipe/functions/api/generate.js"
import { onRequestPost as __api_sync_js_onRequestPost } from "/Users/shoheikoda/Documents/my-ai-company/private/cooking-recipe/functions/api/sync.js"

export const routes = [
    {
      routePath: "/api/detect-ingredients",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_detect_ingredients_js_onRequestPost],
    },
  {
      routePath: "/api/generate",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_generate_js_onRequestPost],
    },
  {
      routePath: "/api/sync",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_sync_js_onRequestPost],
    },
  ]