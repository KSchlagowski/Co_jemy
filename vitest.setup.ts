// Give the test runtime a non-secret SPOONACULAR_API_KEY so `callApi` passes its
// `if (!SPOONACULAR_API_KEY)` guard and reaches `fetch` in the edge-layer tests.
// Not a real secret; `??=` leaves any real value from the environment untouched.
process.env.SPOONACULAR_API_KEY ??= "test-key";
