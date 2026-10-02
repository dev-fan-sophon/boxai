// Prices are in Vietnamese dong. Apply a 10% discount after the first traveller.
export function quoteTour(pricePerTraveller, travellers) {
  return pricePerTraveller * travellers;
}
