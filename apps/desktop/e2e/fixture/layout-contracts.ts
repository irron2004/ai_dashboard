import { expect, type Locator, type Page } from '@playwright/test'

type Box = { x: number; y: number; width: number; height: number }

function intersects(a: Box, b: Box): boolean {
  const horizontal = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const vertical = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return horizontal > 0.5 && vertical > 0.5
}

export async function expectViewportContained(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    html: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    },
    body: {
      scrollWidth: document.body.scrollWidth,
      clientWidth: document.body.clientWidth,
      scrollHeight: document.body.scrollHeight,
      clientHeight: document.body.clientHeight,
    },
  }))
  expect(dimensions.html.scrollWidth, `html horizontal overflow: ${JSON.stringify(dimensions.html)}`).toBeLessThanOrEqual(dimensions.html.clientWidth)
  expect(dimensions.html.scrollHeight, `html vertical overflow: ${JSON.stringify(dimensions.html)}`).toBeLessThanOrEqual(dimensions.html.clientHeight)
  expect(dimensions.body.scrollWidth, `body horizontal overflow: ${JSON.stringify(dimensions.body)}`).toBeLessThanOrEqual(dimensions.body.clientWidth)
  expect(dimensions.body.scrollHeight, `body vertical overflow: ${JSON.stringify(dimensions.body)}`).toBeLessThanOrEqual(dimensions.body.clientHeight)
}

export async function expectElementContained(locator: Locator): Promise<void> {
  const dimensions = await locator.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }))
  expect(dimensions.scrollWidth, `element horizontal overflow: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.clientWidth)
  expect(dimensions.scrollHeight, `element vertical overflow: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.clientHeight)
}

export async function expectNoOverlap(locator: Locator): Promise<void> {
  const boxes = (await locator.evaluateAll((elements) => elements
    .filter((element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    })
    .map((element) => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, label: element.textContent?.trim() ?? '' }
    }))) as Array<Box & { label: string }>

  for (let index = 0; index < boxes.length; index += 1) {
    for (let other = index + 1; other < boxes.length; other += 1) {
      expect(intersects(boxes[index], boxes[other]), `overlap: "${boxes[index].label}" and "${boxes[other].label}"`).toBe(false)
    }
  }
}

export async function expectSingleLineButton(locator: Locator, maxHeight = 42): Promise<void> {
  await expect(locator).toBeVisible()
  const contract = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { height: rect.height, whiteSpace: getComputedStyle(element).whiteSpace }
  })
  expect(contract.height).toBeLessThanOrEqual(maxHeight)
  expect(contract.whiteSpace).toBe('nowrap')
}
