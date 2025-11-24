export const detectDuplicates = (records, keyField = "mobile") => {
  const map = {};
  const duplicates = [];

  records.forEach(rec => {
    const key = rec[keyField];
    if (!key) return;
    if (map[key]) {
      map[key].push(rec);
    } else {
      map[key] = [rec];
    }
  });

  Object.values(map).forEach(group => {
    if (group.length > 1) duplicates.push(...group);
  });

  return duplicates;
};
