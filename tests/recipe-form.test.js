import test from 'node:test';
import assert from 'node:assert/strict';
import { recipeForm, formRecipe } from '../src/client/recipe-form.js';
import {
  recipeCost,
  recipeToToml,
  validateRecipe,
} from '../src/server/recipe.js';

test('form fields round trip through server TOML with multiline text and zero costs', () => {
  const recipe = {
    title: 'Toast "special"',
    ingredients: [
      'Bread',
      { name: 'Salt', cost: { amount: 0, currency: 'USD' } },
    ],
    steps: ['Toast.\nServe with "butter".'],
    nutrition: { carbs_g: 0 },
    source: 'Grandma',
  };
  const form = recipeForm(recipe);
  form.minutes = undefined;
  const result = validateRecipe(recipeToToml(formRecipe(form)));
  for (const key of Object.keys(recipe))
    assert.deepEqual(JSON.parse(JSON.stringify(result[key])), recipe[key]);
  assert.equal(result.cost, undefined);
  assert.equal(result.minutes, undefined);
});

test('server rejects invalid structured recipe input and oversized output', () => {
  for (const input of [
    null,
    [],
    'toml',
    {},
    { title: 'Toast', ingredients: [], steps: [] },
  ])
    assert.throws(() => recipeToToml(input));
  assert.throws(
    () =>
      recipeToToml({
        title: 'Toast',
        ingredients: ['Bread'],
        steps: ['x'.repeat(100001)],
      }),
    /100 KB/,
  );
});

test('ingredient rate text survives form and TOML without automatic totaling', () => {
  const form = recipeForm({
    title: 'Apples',
    ingredients: ['Apples'],
    steps: ['Slice.'],
  });
  form.ingredients[0].cost.amount = '1.99/pound';
  const recipe = validateRecipe(recipeToToml(formRecipe(form)));
  assert.equal(recipe.ingredients[0].cost.amount, '1.99/pound');
  assert.equal(recipeCost(recipe), null);
  form.ingredients[0].cost.amount = '1.99';
  assert.equal(formRecipe(form).ingredients[0].cost.amount, '1.99');
  assert.equal(recipeCost(formRecipe(form)), null);
});

test('text costs cannot be whitespace and total cost accepts text', () => {
  const recipe = {
    title: 'Apples',
    ingredients: [{ name: 'Apples', cost: { amount: ' ', currency: 'USD' } }],
    steps: ['Slice.'],
  };
  assert.throws(() => recipeToToml(recipe), /ingredients/);
  recipe.ingredients = ['Apples'];
  recipe.cost = { amount: '1.99/pound', currency: 'USD' };
  assert.equal(validateRecipe(recipeToToml(recipe)).cost.amount, '1.99/pound');
});

test('ingredient quantities round trip through editing and server TOML', () => {
  for (const quantity of ['200 g', '1/2 cup', 'to taste', 2, 0]) {
    const original = {
      title: 'Toast',
      ingredients: [{ name: 'Bread', quantity }],
      steps: ['Toast.'],
    };
    const recipe = validateRecipe(
      recipeToToml(formRecipe(recipeForm(original))),
    );
    assert.equal(recipe.ingredients[0].quantity, quantity);
    assert.equal(recipe.ingredients[0].name, 'Bread');
  }
});

test('invalid ingredient quantities are rejected', () => {
  for (const quantity of ['', '  ', -1, true, [], {}, Infinity]) {
    assert.throws(
      () =>
        recipeToToml({
          title: 'Toast',
          ingredients: [{ name: 'Bread', quantity }],
          steps: ['Toast.'],
        }),
      /quantity/,
    );
  }
});
