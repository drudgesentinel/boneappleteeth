import { parse } from 'smol-toml';
export const exampleToml = `title = "Lemony pantry pasta"
description = "A little sunshine, made with what you have."
servings = 2
minutes = 20
tags = ["weeknight", "vegetarian"]
# Optional link to the recipe that inspired this one:
# reference = "https://example.com/recipes/lemon-pasta"
# For ingredient-level costs, replace strings with inline tables:
# { name = "200 g spaghetti", cost = { amount = 1.20, currency = "USD" } }
ingredients = [
  "200 g spaghetti",
  "1 lemon, zested and juiced",
  "2 tbsp olive oil",
  "50 g grated parmesan",
  "Salt and black pepper",
]
steps = [
  "Cook the pasta in well-salted water. Save a cup of pasta water.",
  "Warm the olive oil and lemon zest in a pan over low heat.",
  "Toss in the pasta, lemon juice, parmesan, and a splash of pasta water.",
  "Season generously and serve immediately.",
]
# Optional nutrition values, all per serving:
# [nutrition]
# calories_kcal = 450
# protein_g = 15
# carbs_g = 60
# fat_g = 16
# Optional total cost for the entire recipe:
# [cost]
# amount = 6.50
# currency = "USD"
`;
export function validateRecipe(toml) {
  if (typeof toml !== 'string' || Buffer.byteLength(toml) > 100_000)
    throw new Error('Provide a TOML document smaller than 100 KB.');
  let recipe;
  try {
    recipe = parse(toml);
  } catch (error) {
    throw new Error(`Invalid TOML: ${error.message}`);
  }
  if (
    typeof recipe.title !== 'string' ||
    !recipe.title.trim() ||
    recipe.title.length > 200
  )
    throw new Error(
      'title must be a nonempty string of at most 200 characters.',
    );
  if (
    !Array.isArray(recipe.ingredients) ||
    !recipe.ingredients.length ||
    !recipe.ingredients.every((ingredient) =>
      typeof ingredient === 'string'
        ? ingredient.trim()
        : ingredient &&
          !Array.isArray(ingredient) &&
          typeof ingredient.name === 'string' &&
          ingredient.name.trim() &&
          Object.keys(ingredient).every((key) =>
            ['name', 'cost'].includes(key),
          ) &&
          (ingredient.cost === undefined || validCost(ingredient.cost)),
    )
  )
    throw new Error(
      'ingredients must be a nonempty array of strings or tables with a name and optional cost (nonnegative amount and uppercase currency).',
    );
  if (
    !Array.isArray(recipe.steps) ||
    !recipe.steps.length ||
    !recipe.steps.every((step) => typeof step === 'string' && step.trim())
  )
    throw new Error('steps must be a nonempty array of strings.');
  if (
    recipe.description !== undefined &&
    typeof recipe.description !== 'string'
  )
    throw new Error('description must be a string.');
  if (
    recipe.tags !== undefined &&
    (!Array.isArray(recipe.tags) ||
      !recipe.tags.every((tag) => typeof tag === 'string'))
  )
    throw new Error('tags must be an array of strings.');
  if (recipe.reference !== undefined) {
    let url;
    try {
      if (typeof recipe.reference !== 'string') throw new Error();
      url = new URL(recipe.reference);
    } catch {
      throw new Error('reference must be an absolute HTTP or HTTPS URL.');
    }
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error('reference must be an absolute HTTP or HTTPS URL.');
  }
  if (
    recipe.image !== undefined &&
    (typeof recipe.image !== 'string' ||
      !/^\/api\/images\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        recipe.image,
      ))
  )
    throw new Error('image must be the path returned by an image upload.');
  if (recipe.nutrition !== undefined) {
    const fields = ['calories_kcal', 'protein_g', 'carbs_g', 'fat_g'];
    if (
      !recipe.nutrition ||
      Array.isArray(recipe.nutrition) ||
      typeof recipe.nutrition !== 'object' ||
      !Object.keys(recipe.nutrition).length
    )
      throw new Error('nutrition must be a table with at least one nutrient.');
    for (const [key, value] of Object.entries(recipe.nutrition))
      if (
        !fields.includes(key) ||
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0
      )
        throw new Error(
          'nutrition accepts nonnegative calories_kcal, protein_g, carbs_g, and fat_g values per serving.',
        );
  }
  if (recipe.cost !== undefined) {
    const cost = recipe.cost;
    if (!validCost(cost))
      throw new Error(
        'cost requires a nonnegative amount and a three-letter uppercase currency code (for example USD), for the entire recipe.',
      );
  }
  const currencies = recipe.ingredients
    .map((ingredient) => ingredient?.cost?.currency)
    .filter(Boolean);
  if (recipe.cost) currencies.push(recipe.cost.currency);
  if (new Set(currencies).size > 1)
    throw new Error(
      'Use the same currency for all ingredient costs and the recipe cost.',
    );
  for (const field of ['servings', 'minutes'])
    if (
      recipe[field] !== undefined &&
      (!Number.isSafeInteger(recipe[field]) || recipe[field] < 1)
    )
      throw new Error(`${field} must be a positive integer.`);
  return recipe;
}

function validCost(cost) {
  return (
    cost &&
    !Array.isArray(cost) &&
    typeof cost === 'object' &&
    typeof cost.amount === 'number' &&
    Number.isFinite(cost.amount) &&
    cost.amount >= 0 &&
    typeof cost.currency === 'string' &&
    /^[A-Z]{3}$/.test(cost.currency) &&
    Object.keys(cost).every((key) => ['amount', 'currency'].includes(key))
  );
}

export function recipeCost(recipe) {
  if (recipe.cost) return recipe.cost;
  if (
    !recipe.ingredients.length ||
    !recipe.ingredients.every((ingredient) => validCost(ingredient?.cost))
  )
    return null;
  const currency = recipe.ingredients[0].cost.currency;
  if (
    !recipe.ingredients.every(
      (ingredient) => ingredient.cost.currency === currency,
    )
  )
    return null;
  const amount = recipe.ingredients.reduce(
    (sum, ingredient) => sum + ingredient.cost.amount,
    0,
  );
  return Number.isFinite(amount) ? { amount, currency } : null;
}
