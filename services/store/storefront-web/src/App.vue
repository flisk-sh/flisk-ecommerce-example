<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { createCatalogApi, type Order, type Product } from "./api";
import {
	addToCart,
	type Cart,
	cartCount,
	cartTotalCents,
	formatPrice,
	removeFromCart,
	toOrderLines,
} from "./cart";
import "./style.css";

const api = createCatalogApi();
const products = ref<Product[]>([]);
// Search replaces the visible results, but the cart still needs the other products.
const productsById = reactive(new Map<string, Product>());
const cart = ref<Cart>({});
const query = ref("");
const error = ref("");
const loading = ref(true);
const placing = ref(false);
const receipt = ref<Order | null>(null);

const count = computed(() => cartCount(cart.value));
const cartProducts = computed(() =>
	[...productsById.values()].filter((product) => cart.value[product.id]),
);
const total = computed(() => cartTotalCents(cart.value, cartProducts.value));
const cartLines = computed(() =>
	cartProducts.value.map((product) => ({
		product,
		quantity: cart.value[product.id],
	})),
);

async function load() {
	try {
		const results = await api.products(query.value);
		for (const product of results) productsById.set(product.id, product);
		products.value = results;
		error.value = "";
	} catch (e) {
		error.value = `Cannot reach catalog-api: ${(e as Error).message}`;
	} finally {
		loading.value = false;
	}
}

async function checkout() {
	placing.value = true;
	try {
		receipt.value = await api.checkout(toOrderLines(cart.value));
		cart.value = {};
		error.value = "";
		await load(); // stock changed
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		placing.value = false;
	}
}

onMounted(load);
</script>

<template>
  <main class="page">
    <header class="top">
      <div>
        <p class="eyebrow">Vue 3 + Hono on Flisk</p>
        <h1>Coffee Shop</h1>
      </div>
      <form class="search" @submit.prevent="load">
        <input v-model="query" placeholder="Search products…" aria-label="Search products" />
      </form>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="receipt" class="receipt" role="status">
      Order {{ receipt.id }} placed: {{ formatPrice(receipt.totalCents) }}. Thank you!
    </p>

    <div class="layout">
      <section>
        <p v-if="loading" class="muted">Loading…</p>
        <p v-else-if="products.length === 0" class="muted">No products match.</p>
        <ul class="grid">
          <li v-for="product in products" :key="product.id" class="card">
            <h2>{{ product.name }}</h2>
            <p class="muted">{{ product.description }}</p>
            <div class="row">
              <strong>{{ formatPrice(product.priceCents) }}</strong>
              <span v-if="product.stock === 0" class="badge">Sold out</span>
              <button
                v-else
                :disabled="(cart[product.id] ?? 0) >= product.stock"
                @click="cart = addToCart(cart, product)"
              >
                Add
              </button>
            </div>
          </li>
        </ul>
      </section>

      <aside class="cart" aria-label="Cart">
        <h2>Cart ({{ count }})</h2>
        <p v-if="count === 0" class="muted">Your cart is empty.</p>
        <ul>
          <li v-for="line in cartLines" :key="line.product.id" class="row">
            <span>{{ line.quantity }} × {{ line.product.name }}</span>
            <button class="ghost" :aria-label="`Remove one ${line.product.name}`" @click="cart = removeFromCart(cart, line.product.id)">−</button>
          </li>
        </ul>
        <p class="total">
          <span>Total</span> <strong>{{ formatPrice(total) }}</strong>
        </p>
        <button class="wide" :disabled="count === 0 || placing" @click="checkout">
          {{ placing ? 'Placing order…' : 'Checkout' }}
        </button>
      </aside>
    </div>
  </main>
</template>
