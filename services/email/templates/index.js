import { renderFile } from 'pug';
import { resolve } from 'path';

export const getHTMLTemplate = (templateName, locals) => {
  const templatePath = resolve(
    __dirname,
    'services',
    'email',
    'templates',
    templateName
  );

  try {
    return renderFile(templatePath, locals);
  } catch (e) {
    return '';
  }
};
