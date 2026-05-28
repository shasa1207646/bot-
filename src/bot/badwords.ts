// Список нецензурных слов для фильтрации
const BAD_WORDS = [
  'блядь', 'бляд', 'блять', 'сука', 'пизда', 'пиздец', 'хуй', 'хуйня',
  'ебать', 'еба', 'ебаный', 'ебан', 'залупа', 'пиздёж', 'мудак', 'мудила',
  'ёбаный', 'йобаный', 'бля', 'нахуй', 'похуй', 'пиздить', 'охуеть',
  'ахуеть', 'заебал', 'заебись', 'пиздой', 'хуёво', 'дрочить', 'дрочер',
  'pidoras', 'pidor', 'пидор', 'пидарас', 'шлюха', 'шлюшка', 'тварь',
  'ублюдок', 'уёбок', 'уебок', 'долбоёб', 'долбоеб', 'дебил', 'идиот',
];

// Нормализация: убираем повторы символов и лиSpaces
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^а-яёa-z0-9]/gi, '')
    .replace(/(.)\1{2,}/g, '$1'); // убираем повторы (ббляядь → бляд)
}

export function containsBadWord(text: string): boolean {
  const norm = normalize(text);
  return BAD_WORDS.some(word => norm.includes(normalize(word)));
}

export function getBadWords(text: string): string[] {
  const norm = normalize(text);
  return BAD_WORDS.filter(word => norm.includes(normalize(word)));
}
