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
    serviceDown: 'Η υπηρεσία δεν απαντά αυτή τη στιγμή.',
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
    offline: 'Χωρίς σύνδεση στο διαδίκτυο.',
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
    noData: 'χωρίς δεδομένα',
    share: 'Κοινοποίηση στάσης',
    linkCopied: 'Ο σύνδεσμος της στάσης αντιγράφηκε.',
    stopsAway: 'σε {n} στάσεις',
    nextStopAway: 'στην επόμενη στάση',
    farFromCity: 'Η πλησιέστερη στάση αυτής της πόλης απέχει {distance} από εσάς.',
    switchCity: 'Αλλαγή σε: {city}',
    alertLead: 'Ειδοποίηση πριν από',
    alertOn: 'Ειδοποίηση όταν απέχει {n}′',
    alertOff: 'Ακύρωση ειδοποίησης',
    alertArmed: 'Θα ειδοποιηθείτε όταν το {line} απέχει {n}′.',
    alertArmedInApp: 'Θα ειδοποιηθείτε όταν το {line} απέχει {n}′, όσο η εφαρμογή είναι ανοιχτή.',
    alertTitle: 'Γραμμή {line}',
    alertBody: 'Φτάνει στη στάση {stop} σε {n}′.',
    alertBodyNow: 'Φτάνει τώρα στη στάση {stop}.',
    alertLost: 'Το {line} δεν εμφανίζεται πια στις αφίξεις. Η ειδοποίηση ακυρώθηκε.',
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
    serviceDown: 'The bus service is not responding right now.',
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
    offline: 'No internet connection.',
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
    noData: 'no data',
    share: 'Share stop',
    linkCopied: 'Link to this stop copied.',
    stopsAway: '{n} stops away',
    nextStopAway: 'next stop',
    farFromCity: 'The nearest stop in this city is {distance} away.',
    switchCity: 'Switch to {city}',
    alertLead: 'Alert me before',
    alertOn: 'Alert me at {n} min',
    alertOff: 'Cancel alert',
    alertArmed: "You'll be alerted when {line} is {n} min away.",
    alertArmedInApp: "You'll be alerted when {line} is {n} min away, while the app is open.",
    alertTitle: 'Line {line}',
    alertBody: 'Arrives at {stop} in {n} min.',
    alertBodyNow: 'Arriving at {stop} now.',
    alertLost: '{line} is no longer listed. Alert cancelled.',
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

// String() because the slug can come from saved data; see asCity in App.jsx.
const titleCase = (slug) =>
  String(slug ?? '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Display name for a city: the scraped Greek name, or an English one. */
export function cityName(city, lang) {
  if (lang === 'en') return CITY_NAMES_EN[city.slug] ?? titleCase(city.slug);
  return city.name ?? titleCase(city.slug);
}

/**
 * What to tell the user about a failed request. The error's own message is the
 * browser's or the server's English ("Failed to fetch", "Upstream returned 502"),
 * which means nothing in the Greek UI.
 */
export function errorMessage(err, t) {
  // fetch rejects with a TypeError when the request never got an answer.
  if (err instanceof TypeError || navigator.onLine === false) return t('offline');
  if (err?.status >= 500) return t('serviceDown');
  return t('error');
}

export function translator(lang) {
  const table = STRINGS[lang] || STRINGS.el;
  return (key, vars) => {
    let text = table[key] ?? STRINGS.el[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, v);
    return text;
  };
}
