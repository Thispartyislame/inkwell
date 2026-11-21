import { describe, expect, it } from 'vitest'
import { documentFileName, fileSafe, formatDocNumber } from './numbering'
import { normalizeSize, sizeGroup, sortSizes } from './sizes'

describe('numbering', () => {
  it('formats numbers and revisions', () => {
    expect(formatDocNumber('Q-', 1001)).toBe('Q-1001')
    expect(formatDocNumber('Q-', 1001, 2)).toBe('Q-1001-R2')
    expect(formatDocNumber('INV-', 1001, 1)).toBe('INV-1001')
  })
  it('makes safe file names', () => {
    expect(fileSafe("Joe's Pizza & Co.")).toBe('Joes_Pizza_Co')
    expect(fileSafe('Café Olé')).toBe('Cafe_Ole')
    expect(documentFileName(['Q-1001', "Joe's Pizza", 'Summer Staff Tees'])).toBe('Q-1001_Joes_Pizza_Summer_Staff_Tees.pdf')
    expect(documentFileName(['INV-1001', null, ''])).toBe('INV-1001.pdf')
  })
})

describe('sizes', () => {
  it('normalizes aliases', () => {
    expect(normalizeSize(' xxl ')).toBe('2XL')
    expect(normalizeSize('Medium')).toBe('M')
  })
  it('groups sizes', () => {
    expect(sizeGroup('M')).toBe('base')
    expect(sizeGroup('YL')).toBe('base')
    expect(sizeGroup('XXL')).toBe('2xl')
    expect(sizeGroup('3XL')).toBe('3xl')
    expect(sizeGroup('4XL')).toBe('4xl_plus')
    expect(sizeGroup('6XL')).toBe('4xl_plus')
  })
  it('sorts sizes', () => {
    expect(sortSizes(['XL', 'S', '2XL', 'Custom', 'M', 'YS'])).toEqual(['YS', 'S', 'M', 'XL', '2XL', 'Custom'])
  })
})
