import { describe, expect, it } from 'vitest'
import { isDarkHex, guessColorHex } from './colors'
import { groupCsvRows, guessMapping, parseSizes, type CsvMapping } from './csv-import'

describe('guessMapping', () => {
  it('recognizes common supplier headers', () => {
    const m = guessMapping(['Brand Name', 'Style #', 'Description', 'Color Name', 'Size', 'Piece Price'])
    expect(m).toEqual({
      brand: 'Brand Name',
      style_number: 'Style #',
      name: 'Description',
      color: 'Color Name',
      sizes: 'Size',
      cost: 'Piece Price',
      category: null
    })
  })
})

describe('parseSizes', () => {
  it('lists', () => expect(parseSizes('S, M, L, XXL')).toEqual(['S', 'M', 'L', '2XL']))
  it('ranges', () => expect(parseSizes('S-3XL')).toEqual(['S', 'M', 'L', 'XL', '2XL', '3XL']))
  it('single', () => expect(parseSizes('xl')).toEqual(['XL']))
  it('empty', () => expect(parseSizes('')).toEqual([]))
})

const mapping: CsvMapping = { brand: 'brand', style_number: 'style', name: 'name', color: 'color', sizes: 'size', cost: 'cost', category: null }

describe('groupCsvRows', () => {
  it('groups one-row-per-SKU price lists into garments with size-group costs', () => {
    const rows = [
      { brand: 'Gildan', style: '5000', name: 'Heavy Cotton Tee', color: 'Black', size: 'S', cost: '2.50' },
      { brand: 'Gildan', style: '5000', name: 'Heavy Cotton Tee', color: 'Black', size: 'XL', cost: '2.50' },
      { brand: 'Gildan', style: '5000', name: 'Heavy Cotton Tee', color: 'White', size: 'M', cost: '2.10' },
      { brand: 'Gildan', style: '5000', name: 'Heavy Cotton Tee', color: 'Black', size: '2XL', cost: '4.00' },
      { brand: 'Gildan', style: '5000', name: 'Heavy Cotton Tee', color: 'Black', size: '3XL', cost: '5.25' },
      { brand: 'Gildan', style: '18500', name: 'Hooded Sweatshirt', color: 'Navy', size: 'S-XL', cost: '9.00' }
    ]
    const { garments, errors } = groupCsvRows(rows, mapping)
    expect(errors).toEqual([])
    expect(garments).toHaveLength(2)
    const tee = garments[0]
    expect(tee.category).toBe('tee')
    expect(tee.colors.map((c) => c.name)).toEqual(['Black', 'White'])
    expect(tee.colors[0].is_dark).toBe(true)
    expect(tee.sizes).toEqual(['S', 'M', 'XL', '2XL', '3XL'])
    expect(tee.cost_base_cents).toBe(250) // highest base cost wins
    expect(tee.cost_2xl_cents).toBe(400)
    expect(tee.cost_3xl_cents).toBe(525)
    expect(tee.cost_4xl_plus_cents).toBe(525) // falls back to 3XL
    const hood = garments[1]
    expect(hood.category).toBe('hoodie')
    expect(hood.sizes).toEqual(['S', 'M', 'L', 'XL'])
    expect(hood.cost_2xl_cents).toBe(900)
  })

  it('reports bad rows without stopping', () => {
    const { garments, errors } = groupCsvRows(
      [
        { brand: 'X', style: '1', name: 'Tee', color: '', size: 'M', cost: 'abc' },
        { brand: '', style: '', name: '', color: 'Red', size: '', cost: '' },
        { brand: '', style: '', name: '', color: '', size: '', cost: '' }
      ],
      mapping
    )
    expect(garments).toHaveLength(1)
    expect(errors).toEqual([
      { row: 2, message: 'Couldn’t read cost “abc”' },
      { row: 3, message: 'No name or style number' }
    ])
  })
})

describe('colors', () => {
  it('guesses swatches and darkness', () => {
    expect(guessColorHex('Heather Navy')).toBe('#1f2a44')
    expect(isDarkHex(guessColorHex('Black'))).toBe(true)
    expect(isDarkHex(guessColorHex('Charcoal'))).toBe(true)
    expect(isDarkHex(guessColorHex('Sport Grey'))).toBe(false)
    expect(isDarkHex(guessColorHex('White'))).toBe(false)
    expect(isDarkHex(guessColorHex('Gold'))).toBe(false)
  })
})
