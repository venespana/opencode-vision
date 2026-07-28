import { describe, it, expect, beforeEach } from 'vitest';

describe('prompt', () => {
  let renderTemplate: (template: string, images: any[], userText: string) => string;
  let defaultMaximumDetailTemplate: string;

  beforeEach(async () => {
    const prompt = await import('./prompt.js');
    renderTemplate = prompt.renderTemplate;
    defaultMaximumDetailTemplate = prompt.defaultMaximumDetailTemplate;
  });

  // S4: Default maximum-detail template applied when absent
  it('S4: default template is used and placeholders are substituted when no user template', () => {
    const images: any[] = [];
    const result = renderTemplate('', images, 'Describe this');
    // Default template is used and placeholders are substituted
    expect(result).toContain('0 image(s)'); // empty images array
    // The result contains the substituted content (the template is applied)
    expect(result).toContain('Describe this');
  });

  // S4b: default template structure check
  it('S4b: default template contains imageCount and userText placeholders', () => {
    expect(defaultMaximumDetailTemplate).toContain('{imageCount}');
    expect(defaultMaximumDetailTemplate).toContain('{userText}');
  });

  // S5: User template with placeholders substituted
  it('S5: user template substitutes {imageCount} and {userText} placeholders', () => {
    const template = 'There are {imageCount} images. User asked: {userText}';
    const images = [{ partId: 'p1', mime: 'image/png' as const, ref: '/a.png', origin: { kind: 'file' as const, path: '/a.png' } }];
    const result = renderTemplate(template, images, 'What is this?');
    expect(result).toBe('There are 1 images. User asked: What is this?');
  });

  // Edge: multiple images
  it('substitutes correct image count for multiple images', () => {
    const template = 'Images: {imageCount}';
    const images = [
      { partId: 'p1', mime: 'image/png' as const, ref: '/a.png', origin: { kind: 'file' as const, path: '/a.png' } },
      { partId: 'p2', mime: 'image/jpeg' as const, ref: '/b.jpg', origin: { kind: 'file' as const, path: '/b.jpg' } },
    ];
    const result = renderTemplate(template, images, '');
    expect(result).toBe('Images: 2');
  });

  // Edge: template without placeholders is passed through
  it('template without placeholders is returned verbatim', () => {
    const template = 'Analyze the provided images.';
    const images = [{ partId: 'p1', mime: 'image/png' as const, ref: '/a.png', origin: { kind: 'file' as const, path: '/a.png' } }];
    const result = renderTemplate(template, images, 'Tell me');
    expect(result).toBe('Analyze the provided images.');
  });
});
