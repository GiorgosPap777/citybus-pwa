export const LANGS = ['el', 'en'];

const STRINGS = {
  el: {
    appName: 'Λεωφορεία',
    favourites: 'Αγαπημένα',
    nearby: 'Κοντά μου',
    settings: 'Ρυθμίσεις',
    city: 'Πόλη',
    language: 'Γλώσσα',
    close: 'Κλείσιμο',
    arrivals: 'Αφίξεις',
    noService: 'Κανένα λεωφορείο τα επόμενα 30 λεπτά.',
    scheduledHead: 'Επόμενα δρομολόγια (πρόγραμμα)',
    timetable: 'Πρόγραμμα',
    noScheduled: 'Δεν υπάρχουν άλλα δρομολόγια στο πρόγραμμα.',
    tomorrow: 'αύριο',
    loading: 'Φόρτωση…',
    loadingStops: 'Φόρτωση στάσεων…',
    error: 'Κάτι πήγε στραβά.',
    cityUnavailable: 'Αυτή η πόλη δεν παρέχει δεδομένα στάσεων. Δοκιμάστε άλλη πόλη.',
    retry: 'Δοκιμάστε ξανά',
    arriving: 'Φτάνει',
    minShort: '′',
    updated: 'Ενημερώθηκε',
    justNow: 'μόλις τώρα',
    secondsAgo: 'πριν {n}δλ',
    locate: 'Εντοπισμός',
    locating: 'Εντοπισμός…',
    locationDenied: 'Δεν δόθηκε άδεια τοποθεσίας.',
    locationUnavailable: 'Η τοποθεσία δεν είναι διαθέσιμη.',
    locationInsecure: 'Η τοποθεσία απαιτεί σύνδεση HTTPS.',
    noFavourites: 'Πατήστε το ★ σε μια στάση για να την αποθηκεύσετε εδώ.',
    enableLocation: 'Ενεργοποιήστε την τοποθεσία για να δείτε τις κοντινές στάσεις.',
    searchStops: 'Αναζήτηση στάσης…',
    noResults: 'Καμία στάση δεν βρέθηκε.',
    addFavourite: 'Προσθήκη στα αγαπημένα',
    removeFavourite: 'Αφαίρεση από τα αγαπημένα',
    stop: 'Στάση',
    metresAway: '{n} μ.',
    kmAway: '{n} χλμ.',
    offline: 'Εκτός σύνδεσης',
    myLocation: 'Η θέση μου',
    changeCity: 'Αλλαγή πόλης',
    refresh: 'Ανανέωση',
    expandSheet: 'Ανάπτυξη πάνελ',
    collapseSheet: 'Σύμπτυξη πάνελ',
    showRoute: 'Εμφάνιση διαδρομής στον χάρτη',
    back: 'Πίσω',
    backToArrivals: 'Πίσω σε όλες τις αφίξεις',
    crashTitle: 'Κάτι πήγε στραβά',
    crashBody: 'Η εφαρμογή συνάντησε ένα σφάλμα. Η επαναφόρτωση συνήθως το διορθώνει.',
    reload: 'Επαναφόρτωση',
  },
  en: {
    appName: 'City Bus',
    favourites: 'Favourites',
    nearby: 'Near me',
    settings: 'Settings',
    city: 'City',
    language: 'Language',
    close: 'Close',
    arrivals: 'Arrivals',
    noService: 'No buses in the next 30 minutes.',
    scheduledHead: 'Next scheduled departures',
    timetable: 'Timetable',
    noScheduled: 'No more departures in the timetable.',
    tomorrow: 'tomorrow',
    loading: 'Loading…',
    loadingStops: 'Loading stops…',
    error: 'Something went wrong.',
    cityUnavailable: 'This city does not publish stop data. Try another city.',
    retry: 'Try again',
    arriving: 'Arriving',
    minShort: "'",
    updated: 'Updated',
    justNow: 'just now',
    secondsAgo: '{n}s ago',
    locate: 'Locate me',
    locating: 'Locating…',
    locationDenied: 'Location permission denied.',
    locationUnavailable: 'Location is unavailable.',
    locationInsecure: 'Location requires an HTTPS connection.',
    noFavourites: 'Tap ★ on a stop to save it here.',
    enableLocation: 'Turn on location to see the stops closest to you.',
    searchStops: 'Search for a stop…',
    noResults: 'No stops found.',
    addFavourite: 'Add to favourites',
    removeFavourite: 'Remove from favourites',
    stop: 'Stop',
    metresAway: '{n} m',
    kmAway: '{n} km',
    offline: 'Offline',
    myLocation: 'My location',
    changeCity: 'Change city',
    refresh: 'Refresh',
    expandSheet: 'Expand panel',
    collapseSheet: 'Collapse panel',
    showRoute: 'Show route on map',
    back: 'Back',
    backToArrivals: 'Back to all arrivals',
    crashTitle: 'Something went wrong',
    crashBody: 'The app hit an error. Reloading usually fixes it.',
    reload: 'Reload',
  },
};

/**
 * The city list is scraped from citybus.gr, which only publishes Greek operator
 * names ("Αστικό Ηρακλείου"). English names are kept here, keyed by slug. A city
 * added upstream later still gets a readable name: its slug is already a
 * transliteration.
 */
const CITY_NAMES_EN = {
  agrinio: 'Agrinio',
  alexandroupoli: 'Alexandroupoli',
  arta: 'Arta',
  chalkida: 'Chalkida',
  chania: 'Chania',
  chios: 'Chios',
  corfu: 'Corfu',
  drama: 'Drama',
  ioannina: 'Ioannina',
  irakleio: 'Heraklion',
  kastoria: 'Kastoria',
  katerini: 'Katerini',
  kavala: 'Kavala',
  komotini: 'Komotini',
  kozani: 'Kozani',
  lamia: 'Lamia',
  larisa: 'Larissa',
  mesologgi: 'Missolonghi',
  mitilini: 'Mytilene',
  naousa: 'Naousa',
  patra: 'Patras',
  ptolemaida: 'Ptolemaida',
  salamina: 'Salamina (KTEL)',
  serres: 'Serres',
  skiathos: 'Skiathos',
  trikala: 'Trikala',
  veroia: 'Veria',
  volos: 'Volos',
  xanthi: 'Xanthi',
  'yper-xanthi': 'Xanthi (intercity)',
};

const titleCase = (slug) => slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Display name for a city: the scraped Greek name, or an English one. */
export function cityName(city, lang) {
  if (lang === 'en') return CITY_NAMES_EN[city.slug] ?? titleCase(city.slug);
  return city.name ?? titleCase(city.slug);
}

export function translator(lang) {
  const table = STRINGS[lang] || STRINGS.el;
  return (key, vars) => {
    let text = table[key] ?? STRINGS.el[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, v);
    return text;
  };
}
