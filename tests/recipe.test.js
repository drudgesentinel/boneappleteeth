import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exampleToml,
  validateRecipe,
  recipeCost,
} from '../src/server/recipe.js';
test('example is a complete recipe', () => {
  const recipe = validateRecipe(exampleToml);
  assert.equal(recipe.title, 'Lemony pantry pasta');
  assert.equal(recipe.ingredients.length, 5);
});
test('rejects malformed TOML', () =>
  assert.throws(() => validateRecipe('title = "'), /Invalid TOML/));
test('requires title, ingredients, and steps', () => {
  for (const field of ['title', 'ingredients', 'steps'])
    assert.throws(
      () =>
        validateRecipe(
          exampleToml.replace(
            new RegExp(`^${field} = `, 'm'),
            `missing_${field} = `,
          ),
        ),
      new RegExp(field),
    );
});
test('rejects invalid optional fields', () => {
  for (const field of ['servings', 'minutes'])
    assert.throws(
      () =>
        validateRecipe(
          exampleToml.replace(new RegExp(`${field} = \\d+`), `${field} = -1`),
        ),
      /positive integer/,
    );
});
test('rejects oversized or missing input', () => {
  assert.throws(() => validateRecipe(undefined), /Provide/);
  assert.throws(() => validateRecipe('x'.repeat(100001)), /100 KB/);
});
test('accepts comments and extra recipe metadata', () => {
  assert.equal(
    validateRecipe('# Family favorite\n' + exampleToml + '\nsource = "Grandma"')
      .source,
    'Grandma',
  );
});

test('reference is optional and accepts HTTP and HTTPS inspiration links', () => {
  assert.equal(validateRecipe(exampleToml).reference, undefined);
  for (const reference of [
    'https://example.com/recipe?name=toast#method',
    'http://example.com/recipe',
  ]) {
    assert.equal(
      validateRecipe(exampleToml + `\nreference = "${reference}"`).reference,
      reference,
    );
  }
});

test('reference rejects non-string, empty, relative, and unsafe links', () => {
  for (const value of [
    '42',
    '[]',
    '""',
    '"/recipe"',
    '"not a URL"',
    '"javascript:alert(1)"',
    '"data:text/html,test"',
    '"ftp://example.com/recipe"',
  ]) {
    assert.throws(
      () => validateRecipe(exampleToml + `\nreference = ${value}`),
      /reference must be an absolute HTTP or HTTPS URL/,
    );
  }
});

test('accepts optional image, nutrition per serving, and total recipe cost', () => {
  const recipe = validateRecipe(
    exampleToml +
      `
image = "/api/images/12345678-1234-1234-1234-123456789abc"
[nutrition]
calories_kcal = 450
protein_g = 15.5
carbs_g = 0
[cost]
amount = 6.50
currency = "USD"
`,
  );
  assert.equal(recipe.nutrition.protein_g, 15.5);
  assert.equal(recipe.nutrition.carbs_g, 0);
  assert.equal(recipe.cost.amount, 6.5);
  assert.match(recipe.image, /^\/api\/images\//);
});

test('rejects invalid nutrition and cost values', () => {
  for (const extra of [
    'nutrition = "450"',
    'nutrition = []',
    'nutrition = {}',
    '[nutrition]\nprotein_g = -1',
    '[nutrition]\ncalories_kcal = nan',
    '[nutrition]\nfat_g = inf',
    '[nutrition]\ncarbs_g = "10"',
    '[nutrition]\nunknown = 1',
    'cost = []',
    '[cost]\namount = 1',
    '[cost]\ncurrency = "USD"',
    '[cost]\namount = -1\ncurrency = "USD"',
    '[cost]\namount = inf\ncurrency = "USD"',
    '[cost]\namount = 1\ncurrency = "usd"',
    '[cost]\namount = "10"\ncurrency = "USD"',
  ])
    assert.throws(
      () => validateRecipe(exampleToml + '\n' + extra),
      /nutrition|cost/,
    );
});

test('rejects image paths outside uploaded images', () => {
  for (const value of [
    '"https://example.com/image.png"',
    '"javascript:alert(1)"',
    '"/api/images/not-an-id"',
    '42',
  ])
    assert.throws(
      () => validateRecipe(exampleToml + '\nimage = ' + value),
      /image must/,
    );
});

function pricedRecipe(ingredients, extra = '') {
  return validateRecipe(
    `title = "Toast"\nsteps = ["Toast and serve."]\ningredients = ${ingredients}\n${extra}`,
  );
}

test('supports mixed ingredients and validates ingredient-level prices', () => {
  const recipe = pricedRecipe(
    '[{ name = "Bread", cost = { amount = 0, currency = "USD" } }, "Salt"]',
  );
  assert.equal(recipe.ingredients[0].cost.amount, 0);
  assert.equal(recipe.ingredients[1], 'Salt');
  for (const ingredients of [
    '[{}]',
    '[{name = ""}]',
    '[{name = 42}]',
    '[true]',
    '[{name = "Bread", cost = {amount = -1, currency = "USD"}}]',
    '[{name = "Bread", cost = {amount = nan, currency = "USD"}}]',
    '[{name = "Bread", cost = {amount = 1}}]',
    '[{name = "Bread", cost = {amount = 1, currency = "usd"}}]',
  ])
    assert.throws(() => pricedRecipe(ingredients), /ingredients/);
});

test('totals fully priced ingredients without treating missing costs as zero', () => {
  assert.deepEqual(
    recipeCost(
      pricedRecipe(
        '[{name = "Bread", cost = {amount = 1.25, currency = "USD"}}, {name = "Salt", cost = {amount = 0, currency = "USD"}}]',
      ),
    ),
    { amount: 1.25, currency: 'USD' },
  );
  assert.equal(
    recipeCost(
      pricedRecipe(
        '[{name = "Bread", cost = {amount = 1.25, currency = "USD"}}, "Salt"]',
      ),
    ),
    null,
  );
  assert.equal(recipeCost(pricedRecipe('["Bread"]')), null);
});

test('explicit recipe total overrides ingredient sum', () => {
  const recipe = pricedRecipe(
    '[{name = "Bread", cost = {amount = 1.25, currency = "USD"}}]',
    '[cost]\namount = 2.50\ncurrency = "USD"',
  );
  assert.equal(recipeCost(recipe), recipe.cost);
  assert.equal(recipeCost(recipe).amount, 2.5);
});

test('rejects mixed currencies in ingredients and explicit recipe totals', () => {
  assert.throws(
    () =>
      pricedRecipe(
        '[{name = "Bread", cost = {amount = 1, currency = "USD"}}, {name = "Salt", cost = {amount = 1, currency = "EUR"}}]',
      ),
    /same currency/,
  );
  assert.throws(
    () =>
      pricedRecipe(
        '[{name = "Bread", cost = {amount = 1, currency = "USD"}}]',
        '[cost]\namount = 2\ncurrency = "EUR"',
      ),
    /same currency/,
  );
});
