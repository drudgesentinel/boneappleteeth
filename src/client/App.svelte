<script>
  import { onMount } from 'svelte';
  import { parse } from 'smol-toml';
  import { exampleToml, recipeCost } from '../server/recipe.js';
  let user = $state(null);
  let showAuth = $state(false);
  let username = $state('');
  let password = $state('');
  let register = $state(false);
  let authBusy = $state(false);
  let checkingSession = $state(true);
  let recipes = $state([]);
  let selected = $state(null);
  let search = $state('');
  let editing = $state(false);
  let draft = $state('');
  let error = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let deleting = $state(false);
  let estimatedCost = $derived(selected ? recipeCost(selected.recipe) : null);
  let filtered = $derived(
    recipes.filter(({ recipe }) =>
      [
        recipe.title,
        recipe.description,
        ...(recipe.tags || []),
        ...recipe.ingredients.map((ingredient) =>
          typeof ingredient === 'string' ? ingredient : ingredient.name,
        ),
      ]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase()),
    ),
  );
  async function request(url, options) {
    const response = await fetch(url, options);
    if (response.status === 204) return;
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        user = null;
        editing = false;
        showAuth = true;
      }
      throw new Error(data.error || 'Something went wrong.');
    }
    return data;
  }
  async function load() {
    loading = true;
    error = '';
    try {
      recipes = await request('/api/recipes');
      selected = recipes[0] || null;
    } catch {
      error =
        'Could not load recipes. Check that the API and database are running.';
    } finally {
      loading = false;
    }
  }
  onMount(async () => {
    try {
      const response = await fetch('/api/auth/me');
      if (response.ok) {
        user = await response.json();
      } else if (response.status !== 401) {
        error = 'Could not check your session. Please try again.';
      }
    } catch {
      error = 'Could not connect to the API.';
    } finally {
      checkingSession = false;
      await load();
    }
  });
  async function authenticate(event) {
    event.preventDefault();
    authBusy = true;
    error = '';
    try {
      user = await request(`/api/auth/${register ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      password = '';
      showAuth = false;
      await load();
    } catch (e) {
      error = e.message;
    } finally {
      authBusy = false;
    }
  }
  async function logout() {
    authBusy = true;
    error = '';
    try {
      await request('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      user = null;
      editing = false;
      deleting = false;
      draft = '';
      search = '';
    } catch (e) {
      error = e.message;
    } finally {
      authBusy = false;
    }
  }
  function edit(item) {
    if (!user) {
      showAuth = true;
      error = '';
      return;
    }
    selected = item;
    draft = item?.toml || exampleToml;
    editing = true;
    error = '';
    deleting = false;
  }
  function select(item) {
    selected = item;
    editing = false;
    deleting = false;
    error = '';
  }
  async function uploadImage(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    saving = true;
    error = '';
    try {
      if (
        !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
        file.size > 5 * 1024 * 1024
      )
        throw new Error('Choose a PNG, JPEG, or WebP image up to 5 MB.');
      const parsed = parse(draft);
      // Only touch the root-level image assignment; preserve the rest of the document.
      const rootEnd = draft.search(/^\s*\[/m);
      const root = rootEnd < 0 ? draft : draft.slice(0, rootEnd);
      const assignment = /^image\s*=.*$/m;
      if (parsed.image !== undefined && !assignment.test(root))
        throw new Error(
          'Put image on a single line at the top of the TOML before replacing it.',
        );
      const result = await request('/api/images', {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      const line = `image = "${result.image}"`;
      draft =
        parsed.image === undefined
          ? line + '\n' + draft
          : root.replace(assignment, line) + draft.slice(root.length);
    } catch (e) {
      error = e.message;
    } finally {
      saving = false;
      event.target.value = '';
    }
  }
  async function save() {
    saving = true;
    error = '';
    try {
      const item = await request(
        selected ? `/api/recipes/${selected.id}` : '/api/recipes',
        {
          method: selected ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toml: draft }),
        },
      );
      recipes = [item, ...recipes.filter((row) => row.id !== item.id)];
      selected = item;
      editing = false;
    } catch (e) {
      error = e.message;
    } finally {
      saving = false;
    }
  }
  async function remove() {
    saving = true;
    error = '';
    try {
      await request(`/api/recipes/${selected.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      recipes = recipes.filter((row) => row.id !== selected.id);
      selected = recipes[0] || null;
      deleting = false;
    } catch (e) {
      error = e.message;
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head
  ><meta
    name="description"
    content="Your personal recipe book. Save the dishes worth making again."
  /></svelte:head
>

<div class="shell">
  <header>
    <a class="brand" href="/"
      >bone apple teeth<span>THE PERSONAL RECIPE BOOK</span></a
    >{#if user}<div class="account">
        <span>{user.username}</span><button
          onclick={logout}
          disabled={authBusy || saving}>Sign out</button
        >
      </div>{:else}<button onclick={() => (showAuth = true)}>Sign in</button
      >{/if}
  </header>
  <main>
    <section class="intro">
      <div class="eyebrow">A COLLECTION TO COOK FROM</div>
      <h1>Your kitchen, on paper.</h1>
      <p>
        The everyday favorites. The happy accidents. The recipes worth keeping.
      </p>
    </section>
    {#if checkingSession}<p role="status">Checking your session…</p>
    {:else if showAuth && !user}
      <section class="page auth-page">
        <div class="eyebrow">YOUR OWN RECIPE BOX</div>
        <h2>{register ? 'Create an account' : 'Welcome back'}</h2>
        <p class="muted">
          Anyone can browse. Sign in to contribute your own recipes.
        </p>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <form onsubmit={authenticate}>
          <label for="username">Username</label><input
            id="username"
            bind:value={username}
            autocomplete="username"
            pattern={'[a-zA-Z0-9_]{3,32}'}
            minlength="3"
            maxlength="32"
            required
            disabled={authBusy}
          />
          <label for="password">Password</label><input
            id="password"
            type="password"
            bind:value={password}
            autocomplete={register ? 'new-password' : 'current-password'}
            minlength={register ? 12 : 1}
            maxlength="128"
            required
            disabled={authBusy}
          />
          <p class="muted">
            Usernames: 3–32 letters, numbers, or underscores. Passwords: 12–128
            characters.
          </p>
          <div class="actions">
            <button class="primary" disabled={authBusy}
              >{authBusy
                ? 'Please wait…'
                : register
                  ? 'Create account'
                  : 'Sign in'}</button
            ><button
              type="button"
              disabled={authBusy}
              onclick={() => {
                register = !register;
                error = '';
              }}
              >{register
                ? 'Already have an account?'
                : 'Create an account'}</button
            >
          </div>
        </form>
        <button
          onclick={() => {
            showAuth = false;
            error = '';
          }}>Browse recipes</button
        >
      </section>
    {:else}
      <div class="workspace">
        <aside>
          <div class="collection-heading">
            <h2>The recipe box <span>{recipes.length}</span></h2>
            <button class="primary" onclick={() => edit(null)} disabled={saving}
              >+ Add recipe</button
            >
          </div>
          <label class="search"
            ><span>Search your collection</span><input
              type="search"
              placeholder="Try pasta, lemon, weeknight…"
              bind:value={search}
            /></label
          >
          <div class="recipe-list">
            {#if loading}<p class="muted">Opening your recipe box…</p>
            {:else if filtered.length === 0}<p class="muted">
                {search
                  ? 'No recipes match your search.'
                  : 'A fresh page. Add your first recipe to begin.'}
              </p>{/if}
            {#each filtered as item}
              <button
                class:active={selected?.id === item.id}
                class="recipe-card"
                onclick={() => select(item)}
                disabled={saving}
              >
                <span class="card-category"
                  >{item.recipe.tags?.[0] || 'FROM YOUR KITCHEN'}</span
                ><strong>{item.recipe.title}</strong><span
                  class="card-description"
                  >{item.recipe.description || 'A recipe worth keeping.'}</span
                ><span class="card-meta"
                  >{item.recipe.minutes
                    ? `${item.recipe.minutes} min`
                    : 'Take your time'} · {item.author || 'Unknown contributor'}
                  <span>↗</span></span
                >
              </button>
            {/each}
          </div>
          <p class="aside-note">
            A little collection.<br />A lot of good meals.
          </p>
        </aside>
        <section class="page" aria-label="Recipe detail">
          {#if error}<div class="error" role="alert">
              {error}{#if !editing}<button onclick={load}>Retry loading</button
                >{/if}
            </div>{/if}
          {#if editing}
            <div class="eyebrow">
              {selected ? 'MAKE IT YOUR OWN' : 'SOMETHING NEW FOR THE TABLE'}
            </div>
            <h2>{selected ? 'Edit recipe' : 'A new favorite'}</h2>
            <p class="muted">
              Write your recipe in TOML. Comments and formatting are saved with
              it.
            </p>
            <form
              onsubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <label class="editor-label" for="image-upload"
                >Recipe image (optional)</label
              >
              <input
                id="image-upload"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onchange={uploadImage}
                disabled={saving}
              />
              <p class="muted">
                PNG, JPEG, or WebP, up to 5 MB. Uploading adds an image path to
                your TOML. Remove the image line to remove it from the recipe.
              </p>
              <label class="editor-label" for="toml">Recipe TOML</label
              ><textarea
                id="toml"
                bind:value={draft}
                spellcheck="false"
                required
                disabled={saving}
              ></textarea>
              <div class="actions">
                <button class="primary" disabled={saving}
                  >{saving ? 'Saving…' : 'Save recipe'}</button
                ><button
                  type="button"
                  onclick={() => {
                    editing = false;
                    error = '';
                  }}
                  disabled={saving}>Cancel</button
                >
              </div>
            </form>
          {:else if selected}
            <div class="detail-top">
              <div class="eyebrow">FROM THE RECIPE BOX</div>
              {#if user && selected.user_id === user.id}<button
                  onclick={() => edit(selected)}
                  disabled={saving}>Edit recipe ↗</button
                >{/if}
            </div>
            {#if selected.recipe.image}<img
                class="recipe-image"
                src={selected.recipe.image}
                alt={selected.recipe.title}
              />{/if}
            <h2 class="recipe-title">{selected.recipe.title}</h2>
            <p class="description">{selected.recipe.description || ''}</p>
            <p class="muted">
              Contributed by {selected.author || 'Unknown contributor'}
            </p>
            {#if selected.recipe.reference}
              <p class="muted">
                Inspired by <a
                  href={selected.recipe.reference}
                  target="_blank"
                  rel="noopener noreferrer">the original recipe ↗</a
                >
              </p>
            {/if}
            <div class="facts">
              {#if selected.recipe.minutes}<span
                  ><small>TIME</small>{selected.recipe.minutes} minutes</span
                >{/if}{#if selected.recipe.servings}<span
                  ><small>SERVES</small>{selected.recipe.servings} people</span
                >{/if}<span
                ><small>FILED UNDER</small>{selected.recipe.tags?.join(' · ') ||
                  'Everyday cooking'}</span
              >
            </div>
            {#if selected.recipe.nutrition}
              <section aria-label="Nutrition">
                <h3>Nutrition <small>(per serving)</small></h3>
                <div class="facts">
                  {#each Object.entries(selected.recipe.nutrition) as [key, value]}<span
                      ><small
                        >{{
                          calories_kcal: 'Calories',
                          protein_g: 'Protein',
                          carbs_g: 'Carbohydrates',
                          fat_g: 'Fat',
                        }[key]}</small
                      >{value}
                      {key === 'calories_kcal' ? 'kcal' : 'g'}</span
                    >{/each}
                </div>
              </section>
            {/if}
            {#if estimatedCost}<p class="muted">
                Estimated cost (whole recipe): <strong
                  >{estimatedCost.currency}
                  {estimatedCost.amount.toFixed(2)}</strong
                >
              </p>{/if}
            <div class="recipe-body">
              <div>
                <h3>Ingredients</h3>
                <ul>
                  {#each selected.recipe.ingredients as ingredient}<li>
                      {typeof ingredient === 'string'
                        ? ingredient
                        : ingredient.name}
                      {#if typeof ingredient !== 'string' && ingredient.cost}<span
                          class="ingredient-cost"
                          >{ingredient.cost.currency}
                          {ingredient.cost.amount.toFixed(2)}</span
                        >{/if}
                    </li>{/each}
                </ul>
              </div>
              <div>
                <h3>Let’s cook</h3>
                <ol>
                  {#each selected.recipe.steps as step}<li>{step}</li>{/each}
                </ol>
              </div>
            </div>
            <div class="recipe-bottom">
              <span>Made to be made again.</span
              >{#if user && selected.user_id === user.id}{#if deleting}<span
                    >Delete this recipe?</span
                  ><button class="danger" onclick={remove} disabled={saving}
                    >Confirm delete</button
                  ><button onclick={() => (deleting = false)} disabled={saving}
                    >Keep it</button
                  >{:else}<button
                    class="delete"
                    onclick={() => (deleting = true)}>Delete recipe</button
                  >{/if}{/if}
            </div>
          {:else}
            <div class="empty">
              <div class="empty-mark">✳</div>
              <div class="eyebrow">EVERY GOOD MEAL STARTS SOMEWHERE</div>
              <h2>Make room for<br />your favorites.</h2>
              <p>
                A handwritten classic or last night’s experiment.<br />Give it a
                home in your recipe box.
              </p>
              <button
                class="primary"
                onclick={() => edit(null)}
                disabled={loading}>Add your first recipe ↗</button
              >
            </div>
          {/if}
        </section>
      </div>
    {/if}
  </main>
  <footer>
    <span>BONE APPLE TEETH</span><span>For the love of a home-cooked meal.</span
    >
  </footer>
</div>
