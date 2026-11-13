const STORAGE_KEY = 'tac_favorite_cards';

const favoriteSet = new Set(
  JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    .map(Number)
    .filter(n => !isNaN(n) && n >= 1 && n <= 510)
);

function persistFavorites() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...favoriteSet].sort((a, b) => a - b)));
}

export function isFavoriteCard(cardId) {
  return favoriteSet.has(Number(cardId));
}

export function toggleFavoriteCard(cardId) {
  const id = Number(cardId);
  if (favoriteSet.has(id)) {
    favoriteSet.delete(id);
  } else {
    favoriteSet.add(id);
  }
  persistFavorites();
  return favoriteSet.has(id);
}

export function getFavoriteCount() {
  return favoriteSet.size;
}
