/** Region-appropriate name pools so the directory looks like a real global org. */
interface NamePool {
  first: readonly string[];
  last: readonly string[];
}

const ANGLO: NamePool = {
  first: ['James', 'Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Mason', 'Isabella',
    'Lucas', 'Mia', 'Jack', 'Charlotte', 'Henry', 'Amelia', 'Leo', 'Harper', 'Owen', 'Grace'],
  last: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson', 'Taylor',
    'Anderson', 'Thomas', 'Moore', 'Martin', 'Clark', 'Lewis', 'Walker', 'Hall', 'Young', 'King', 'Wright'],
};

const INDIAN: NamePool = {
  first: ['Aarav', 'Ananya', 'Vivaan', 'Diya', 'Aditya', 'Isha', 'Arjun', 'Kavya', 'Rohan', 'Priya',
    'Rahul', 'Sneha', 'Karan', 'Pooja', 'Vikram', 'Neha', 'Siddharth', 'Riya', 'Aman', 'Meera'],
  last: ['Sharma', 'Verma', 'Patel', 'Gupta', 'Singh', 'Kumar', 'Iyer', 'Reddy', 'Nair', 'Mehta',
    'Joshi', 'Rao', 'Kapoor', 'Malhotra', 'Bose', 'Chopra', 'Desai', 'Agarwal', 'Pillai', 'Kalra'],
};

const GERMANIC: NamePool = {
  first: ['Lukas', 'Mia', 'Finn', 'Emma', 'Jonas', 'Hannah', 'Luca', 'Lea', 'Daan', 'Sanne',
    'Felix', 'Lena', 'Ben', 'Anna', 'Max', 'Julia', 'Sem', 'Lotte', 'Paul', 'Marie'],
  last: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'de Jong',
    'Jansen', 'de Vries', 'van Dijk', 'Bakker', 'Hoffmann', 'Koch', 'Richter', 'Klein', 'Wolf', 'Visser', 'Smit'],
};

const FRENCH: NamePool = {
  first: ['Gabriel', 'Louise', 'Léo', 'Jade', 'Raphaël', 'Alice', 'Arthur', 'Chloé', 'Hugo', 'Inès',
    'Jules', 'Léa', 'Louis', 'Manon', 'Adam', 'Camille', 'Nathan', 'Zoé', 'Théo', 'Clara'],
  last: ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau',
    'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier'],
};

const BRAZILIAN: NamePool = {
  first: ['Miguel', 'Helena', 'Arthur', 'Alice', 'Heitor', 'Laura', 'Bernardo', 'Manuela', 'Davi', 'Valentina',
    'Gael', 'Sophia', 'Pedro', 'Isabela', 'Lucas', 'Júlia', 'Matheus', 'Beatriz', 'Rafael', 'Mariana'],
  last: ['Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes',
    'Costa', 'Ribeiro', 'Martins', 'Carvalho', 'Almeida', 'Lopes', 'Barbosa', 'Rocha', 'Dias', 'Moreira'],
};

const SINGAPOREAN: NamePool = {
  first: ['Wei', 'Hui Min', 'Jun Jie', 'Xin Yi', 'Ming', 'Siti', 'Hafiz', 'Nurul', 'Ravi', 'Priya',
    'Kai', 'Mei Ling', 'Zhi Hao', 'Shu Fen', 'Darren', 'Rachel', 'Farid', 'Aisyah', 'Kumar', 'Grace'],
  last: ['Tan', 'Lim', 'Lee', 'Ng', 'Ong', 'Wong', 'Goh', 'Chua', 'Chan', 'Koh',
    'Teo', 'Ang', 'Yeo', 'Tay', 'Ho', 'Low', 'Toh', 'Sim', 'Rahman', 'Pillai'],
};

const POOLS_BY_COUNTRY: Record<string, NamePool> = {
  US: ANGLO, GB: ANGLO, CA: ANGLO, AU: ANGLO,
  IN: INDIAN,
  DE: GERMANIC, NL: GERMANIC,
  FR: FRENCH,
  BR: BRAZILIAN,
  SG: SINGAPOREAN,
};

export function namePoolFor(countryCode: string): NamePool {
  return POOLS_BY_COUNTRY[countryCode] ?? ANGLO;
}

/** ASCII, lowercase, dot-separated email local part: "Léa de Jong" -> "lea.dejong". */
export function emailLocalPart(first: string, last: string): string {
  const clean = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  return `${clean(first)}.${clean(last)}`;
}
