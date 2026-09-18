document.documentElement.classList.add('js')

// Theme switcher (light / dark mode)
const themeToggles = document.querySelectorAll('[data-theme-toggle]')
const savedTheme = localStorage.getItem('twigraph-theme')
const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
let currentTheme = savedTheme || (systemDark ? 'dark' : 'light')

const applyTheme = (theme) => {
  currentTheme = theme
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem('twigraph-theme', theme)
  const metaThemeColor = document.querySelector('meta[name="theme-color"]')
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', theme === 'dark' ? '#090d14' : '#fafafa')
  }
  themeToggles.forEach((btn) => {
    btn.setAttribute(
      'aria-label',
      theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
    )
  })
}

applyTheme(currentTheme)

themeToggles.forEach((btn) => {
  btn.addEventListener('click', () => {
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark'
    applyTheme(nextTheme)
  })
})

// Header & Navigation elements
const header = document.querySelector('[data-header]')
const menuButton = document.querySelector('[data-menu-button]')
const navLinks = document.querySelector('#nav-links')
const copyButton = document.querySelector('[data-copy]')
const copyStatus = document.querySelector('[data-copy-status]')
const command = document.querySelector('[data-command]')

const promptInput = document.querySelector('#hero-prompt')
const promptSubmit = document.querySelector('#hero-submit')
const suggestions = document.querySelectorAll('.suggestion')
const proofQuery = document.querySelector('#proof-query-text')
const parallaxElements = document.querySelectorAll('[data-parallax]')

// Header scroll transformation (qwenwork.ai floating pill)
const updateHeader = () => {
  header?.classList.toggle('is-scrolled', window.scrollY > 30)
}

const closeMenu = (restoreFocus = false) => {
  menuButton?.setAttribute('aria-expanded', 'false')
  menuButton?.setAttribute('aria-label', 'Open navigation')
  navLinks?.classList.remove('is-open')
  if (restoreFocus) menuButton?.focus()
}

updateHeader()
window.addEventListener('scroll', updateHeader, { passive: true })

// Mobile menu toggle
menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true'
  if (!open) {
    closeMenu()
    return
  }
  menuButton.setAttribute('aria-expanded', 'true')
  menuButton.setAttribute('aria-label', 'Close navigation')
  navLinks?.classList.add('is-open')
  navLinks?.querySelector('a')?.focus()
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuButton?.getAttribute('aria-expanded') === 'true') {
    closeMenu(true)
  }
})

navLinks?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => closeMenu())
})

document.addEventListener('click', (event) => {
  if (
    menuButton?.getAttribute('aria-expanded') === 'true' &&
    navLinks &&
    !navLinks.contains(event.target) &&
    !menuButton.contains(event.target)
  ) {
    closeMenu()
  }
})

// Parallax floating decorative elements (qwenwork hero-float effect)
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

if (!reduceMotion && parallaxElements.length > 0) {
  let ticking = false
  const updateParallax = () => {
    const scrollY = window.scrollY
    parallaxElements.forEach((el) => {
      const speed = Number.parseFloat(el.getAttribute('data-parallax') || '0.1')
      const offset = scrollY * speed
      el.style.transform = `translateY(${-offset}px)`
    })
    ticking = false
  }

  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        window.requestAnimationFrame(updateParallax)
        ticking = true
      }
    },
    { passive: true },
  )
}

// Interactive Hero Prompt Box
const handlePromptSubmit = () => {
  const query = promptInput?.value?.trim()
  if (!query) return

  if (proofQuery) {
    proofQuery.textContent = query
  }

  // Smooth scroll to product proof section
  const proofSection = document.querySelector('#product')
  if (proofSection) {
    proofSection.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
  }
}

promptSubmit?.addEventListener('click', handlePromptSubmit)
promptInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handlePromptSubmit()
  }
})

suggestions.forEach((btn) => {
  btn.addEventListener('click', () => {
    const promptText = btn.getAttribute('data-prompt') || ''
    if (promptInput) {
      promptInput.value = promptText
      promptInput.focus()
    }
    handlePromptSubmit()
  })
})

// Copy commands to clipboard
copyButton?.addEventListener('click', async () => {
  if (!command?.textContent) return
  try {
    await navigator.clipboard.writeText(command.textContent)
    copyButton.textContent = 'Copied'
    if (copyStatus) copyStatus.textContent = 'Commands copied to the clipboard.'
    window.setTimeout(() => {
      copyButton.textContent = 'Copy commands'
    }, 1600)
  } catch {
    copyButton.textContent = 'Select the commands'
    if (copyStatus) copyStatus.textContent = 'Copy was unavailable. Select the commands manually.'
  }
})

// Scroll reveal animations
const reveals = document.querySelectorAll('.reveal')

if (reduceMotion || !('IntersectionObserver' in window)) {
  reveals.forEach((element) => element.classList.add('is-visible'))
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      })
    },
    { threshold: 0.1 },
  )
  reveals.forEach((element) => observer.observe(element))
}
