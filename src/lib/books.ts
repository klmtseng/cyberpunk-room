// Real public-domain books, served full-text through the /__book proxy.
// Shared by the 藏書閣 reader app (os.ts) and the physical shelf (room.ts).
export interface Book {
  id: number;        // Project Gutenberg id (verified reachable)
  title: string;
  author: string;
  tag: string;
  spine: number;     // spine base color
  zh: boolean;       // vertical CJK spine text
}

export const BOOKS: Book[] = [
  { id: 24264, title: '紅樓夢', author: '曹雪芹', tag: '古典', spine: 0x6e3a3a, zh: true },
  { id: 23950, title: '三國志演義', author: '羅貫中', tag: '古典', spine: 0x7a4a2a, zh: true },
  { id: 23962, title: '西遊記', author: '吳承恩', tag: '古典', spine: 0x5a6e3a, zh: true },
  { id: 23863, title: '水滸傳', author: '施耐庵', tag: '古典', spine: 0x3a5a6e, zh: true },
  { id: 132, title: '孫子兵法', author: '孫子', tag: 'STRATEGY', spine: 0x8a2a2a, zh: true },
  { id: 84, title: 'FRANKENSTEIN', author: 'Shelley', tag: 'PROTO-SF', spine: 0x2a4a3a, zh: false },
  { id: 35, title: 'THE TIME MACHINE', author: 'Wells', tag: 'PROTO-SF', spine: 0x3a3a5e, zh: false },
  { id: 164, title: '20,000 LEAGUES', author: 'Verne', tag: 'PROTO-SF', spine: 0x2a5a5a, zh: false },
  { id: 345, title: 'DRACULA', author: 'Stoker', tag: 'GOTHIC', spine: 0x4a2a4a, zh: false },
  { id: 174, title: 'DORIAN GRAY', author: 'Wilde', tag: 'GOTHIC', spine: 0x5a4a2a, zh: false },
  { id: 1661, title: 'SHERLOCK HOLMES', author: 'Doyle', tag: 'NOIR', spine: 0x3a3a3a, zh: false },
  { id: 2554, title: 'CRIME AND PUNISHMENT', author: 'Dostoevsky', tag: 'NOIR', spine: 0x2a2a36, zh: false },
  { id: 1184, title: 'MONTE CRISTO', author: 'Dumas', tag: '復仇', spine: 0x6e5a2a, zh: false },
  { id: 2701, title: 'MOBY DICK', author: 'Melville', tag: '執念', spine: 0x26364a, zh: false },
  { id: 1342, title: 'PRIDE & PREJUDICE', author: 'Austen', tag: '世情', spine: 0x6e4a5a, zh: false },
  { id: 996, title: 'DON QUIXOTE', author: 'Cervantes', tag: '史詩', spine: 0x7a6a3a, zh: false },
  { id: 1727, title: 'THE ODYSSEY', author: 'Homer', tag: '史詩', spine: 0x4a5a3a, zh: false },
  { id: 2680, title: 'MEDITATIONS', author: 'Aurelius', tag: '哲學', spine: 0x55502f, zh: false },
  { id: 11, title: 'ALICE IN WONDERLAND', author: 'Carroll', tag: '奇想', spine: 0x4a5a7a, zh: false },
  { id: 74, title: 'TOM SAWYER', author: 'Twain', tag: '冒險', spine: 0x7a5a3a, zh: false },
  { id: 76, title: 'HUCKLEBERRY FINN', author: 'Twain', tag: '冒險', spine: 0x6a4a2e, zh: false },
  { id: 98, title: 'A TALE OF TWO CITIES', author: 'Dickens', tag: '世情', spine: 0x5a3a3a, zh: false },
  { id: 1400, title: 'GREAT EXPECTATIONS', author: 'Dickens', tag: '世情', spine: 0x3e4a3a, zh: false },
  { id: 768, title: 'WUTHERING HEIGHTS', author: 'E. Brontë', tag: 'GOTHIC', spine: 0x3a2e3e, zh: false },
  { id: 1260, title: 'JANE EYRE', author: 'C. Brontë', tag: '世情', spine: 0x5e3a4a, zh: false },
  { id: 120, title: 'TREASURE ISLAND', author: 'Stevenson', tag: '冒險', spine: 0x2e5a4a, zh: false },
  { id: 43, title: 'JEKYLL AND HYDE', author: 'Stevenson', tag: 'GOTHIC', spine: 0x46324e, zh: false },
  { id: 36, title: 'WAR OF THE WORLDS', author: 'Wells', tag: 'PROTO-SF', spine: 0x6e2e2e, zh: false },
  { id: 5230, title: 'THE INVISIBLE MAN', author: 'Wells', tag: 'PROTO-SF', spine: 0x3a4a5e, zh: false },
  { id: 159, title: 'DR. MOREAU', author: 'Wells', tag: 'PROTO-SF', spine: 0x2e4a3e, zh: false },
  { id: 1232, title: 'THE PRINCE', author: 'Machiavelli', tag: 'STRATEGY', spine: 0x6a1e1e, zh: false },
  { id: 1497, title: 'THE REPUBLIC', author: 'Plato', tag: '哲學', spine: 0x4a4a36, zh: false },
  { id: 1998, title: 'ZARATHUSTRA', author: 'Nietzsche', tag: '哲學', spine: 0x2e2e3a, zh: false },
  { id: 2600, title: 'WAR AND PEACE', author: 'Tolstoy', tag: '史詩', spine: 0x4e3e2e, zh: false },
  { id: 135, title: 'LES MISÉRABLES', author: 'Hugo', tag: '史詩', spine: 0x36324a, zh: false },
  { id: 158, title: 'EMMA', author: 'Austen', tag: '世情', spine: 0x6e5a6a, zh: false },
  { id: 105, title: 'PERSUASION', author: 'Austen', tag: '世情', spine: 0x5a4e6a, zh: false },
  { id: 4300, title: 'ULYSSES', author: 'Joyce', tag: '現代', spine: 0x2a3a4a, zh: false },
  { id: 100, title: 'SHAKESPEARE 全集', author: 'Shakespeare', tag: '史詩', spine: 0x5e4a1e, zh: false },
  { id: 1399, title: 'ANNA KARENINA', author: 'Tolstoy', tag: '世情', spine: 0x6a3a4a, zh: false },
  { id: 844, title: 'BEING EARNEST', author: 'Wilde', tag: '喜劇', spine: 0x4a6a5a, zh: false },
  { id: 2542, title: "A DOLL'S HOUSE", author: 'Ibsen', tag: '戲劇', spine: 0x5a5a6e, zh: false },
  { id: 2148, title: 'POE: WORKS VOL.2', author: 'Poe', tag: 'GOTHIC', spine: 0x26262e, zh: false },
  { id: 3600, title: 'MONTAIGNE ESSAYS', author: 'Montaigne', tag: '哲學', spine: 0x4e4636, zh: false },
];
