export function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function getLanguageByExtension(fileName, languages) {
  const ext = fileName.includes('.') ? `.${fileName.split('.').pop().toLowerCase()}` : '';
  const match = Object.values(languages).find((lang) => {
    const extensions = lang.extensions || [lang.fileExt];
    return extensions.some((item) => item?.toLowerCase() === ext);
  });
  return match ? match.id : 'java';
}
