// Chapter III dialogue. Original lines throughout.
import { crewById, ODYSSEUS, POLYPHEMUS } from './crew.js';

const C = (id) => crewById(id);
const O = ODYSSEUS, P = POLYPHEMUS;

export const BARKS = {
  landing: [
    ['odysseus', 'Smoke on the mountain. Someone lives here.'],
    ['perimedes', "I brought Maron's wine, as you asked. Strong enough to drop a god."],
    ['eurylochus', 'Twelve men, my king. No more. The rest stay with the ship.'],
  ],
  boars: ['lycaon', 'Boars! Let them come to your shield, then strike!'],
  boarsDone: ['ariston', 'Ha! Tonight we eat like kings. If this island has a king, he owes us dinner.'],
  mouth: ['polites', "Look at the size of that doorway... What kind of shepherd needs a door like that?"],
  staff: ['thrasios', 'Green olive. Long as a mast. With an edge on it... it could do terrible work.'],
  sharpen: ['damon', 'Scrape only when he is loud, my king. Silence is our shield.'],
  greedy: [['antiphus', 'Just one more wheel! They\'re the size of shields!'], ['elpenor', 'I can carry two. Three, if I run!']],
  hidden: ['kallias', '...he is here.'],
  climaxWhisper: ['polites', 'Now. While the wine holds him.'],
  sheep: ['eurylochus', 'Under the bellies. Hold to the wool and do not breathe.'],
  daylight: ['nikandros', 'The ship! Run, brothers! RUN!'],
};

export function caveChoice(alive) {
  const speaker = alive('eurylochus') ? C('eurylochus') : C('polites');
  return [
    { who: C('antiphus'), text: 'Cheeses! Cheeses like shields, and pens full of lambs!' },
    { who: speaker, text: 'This is no shepherd\'s hut, my king. Take what we can carry and go. Now.' },
    { who: O, text: 'Hm.', choices: [
      { text: 'We wait. I would meet our host and ask for a guest\'s gifts.', value: 'wait' },
      { text: 'Agreed. Load up, quickly. We leave before he returns.', value: 'leave' },
    ] },
  ];
}

export const WINE_SCENE = (alive) => [
  { who: P, text: 'Mm. A little man, walking into my fire like a moth.' },
  { who: O, text: 'We are travelers, far from home. The gods protect guests.' },
  { who: P, text: 'Gods? My kind does not bow to gods. We are older than your gods, and larger.' },
  { who: O, text: 'Then let me give you something the gods themselves would envy. Drink. Wine from across the sea, poured for a host.' },
  { who: P, text: '...', auto: 1.6 },
  { who: P, text: 'Ahhh. This is rain from heaven. Another!' },
  { who: P, text: 'More! Tell me your name, little one, so I can give you a guest\'s gift.', timed: 9, defaultValue: 'silent',
    choices: [
      { text: '"My name is Nobody. Everyone calls me Nobody."', value: 'nobody' },
      { text: '"I am Odysseus, son of Laertes, king of Ithaca."', value: 'odysseus' },
    ],
    timeoutThen: [{ who: O, text: '...' }],
  },
];

export const WINE_AFTER = {
  nobody: [
    { who: P, text: 'Nobody. Then here is my gift, Nobody...' },
    { who: P, text: 'I will eat you last.', auto: 2.4 },
  ],
  odysseus: [
    { who: P, text: 'Odysseus? A king\'s name for a mouse. Here is my gift, Odysseus...' },
    { who: P, text: 'I will eat you last.', auto: 2.4 },
  ],
  silent: [
    { who: P, text: 'No name? Then you are nobody. Nobody, I will eat last.', auto: 3 },
  ],
};

export const BLIND_LINES = {
  nobody: [
    ['Polyphemus', 'BROTHERS! Help me! Nobody is killing me! Nobody has blinded me!'],
    ['A voice outside', 'If nobody is hurting you, brother, your pain comes from the gods. Pray to your father, and let us sleep.'],
  ],
  odysseus: [
    ['Polyphemus', 'BROTHERS! Odysseus! Odysseus of Ithaca has blinded me!'],
    ['A voice outside', 'We hear you, brother. We are coming down the mountain.'],
  ],
  silent: [
    ['Polyphemus', 'BROTHERS! Help me! Nobody is killing me!'],
    ['A voice outside', 'Nobody? Then be quiet, and pray to your father.'],
  ],
};

export const RAM_MONOLOGUE = [
  'My ram... You are always first to the meadow. First to the stream at evening.',
  'Why are you last today? Are you grieving for your master\'s eye?',
  'If you could speak, you would tell me where he hides.',
];

export const SHOUT = {
  ody: 'Cyclops! If any man asks who took your eye, tell him it was Odysseus! Odysseus of Ithaca, son of Laertes, sacker of cities!',
  curse1: 'Father! Earth-Shaker! Hear your son!',
  curse2: 'Let Odysseus never reach his home. Or if he must, let him come late, alone, on a stranger\'s ship, and find trouble in his house.',
};
export const SILENT_LINES = [
  ['eurylochus', 'Let him curse the empty sea. We are already gone.'],
  ['polites', 'He doesn\'t even know whose name to curse. That is the cleverest thing you have ever done.'],
];

export const EPITAPHS = {
  shout: 'You gave the sea your name. It will remember.',
  silent: 'Nobody came, and Nobody left. The sea does not know whom to hate.',
};
