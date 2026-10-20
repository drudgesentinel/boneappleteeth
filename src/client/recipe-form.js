export const nutrients = {
  calories_kcal: 'Calories (kcal)',
  protein_g: 'Protein (g)',
  carbs_g: 'Carbohydrates (g)',
  fat_g: 'Fat (g)',
};

export function recipeForm(recipe = {}) {
  return {
    ...recipe,
    title: recipe.title || '',
    description: recipe.description || '',
    tags: recipe.tags?.join(', ') || '',
    ingredients: (recipe.ingredients || ['']).map((item) => ({
      quantity: '',
      ...(typeof item === 'string' ? { name: item } : item),
      cost: { amount: '', currency: 'USD', ...item.cost },
    })),
    steps: [...(recipe.steps || [''])],
    nutrition: { ...recipe.nutrition },
    cost: { amount: '', currency: 'USD', ...recipe.cost },
  };
}

export function formRecipe(form) {
  const recipe = structuredClone(form);
  recipe.tags = form.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  for (const key of ['reference', 'image', 'servings', 'minutes'])
    if (recipe[key] === '' || recipe[key] == null) delete recipe[key];
  const hasAmount = (cost) => cost.amount !== '' && cost.amount != null;
  recipe.ingredients = recipe.ingredients.map(({ name, quantity, cost }) => {
    const hasQuantity = quantity !== '' && quantity != null;
    if (!hasQuantity && !hasAmount(cost)) return name;
    return {
      name,
      ...(hasQuantity ? { quantity } : {}),
      ...(hasAmount(cost) ? { cost } : {}),
    };
  });
  if (!hasAmount(recipe.cost)) delete recipe.cost;
  recipe.nutrition = Object.fromEntries(
    Object.entries(recipe.nutrition).filter(
      ([, value]) => value !== '' && value != null,
    ),
  );
  if (!Object.keys(recipe.nutrition).length) delete recipe.nutrition;
  return recipe;
}
