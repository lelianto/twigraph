document.documentElement.classList.add('js')

const header = document.querySelector('[data-header]')
const menuButton = document.querySelector('[data-menu-button]')
const navLinks = document.querySelector('#nav-links')
const copyButton = document.querySelector('[data-copy]')
const copyStatus = document.querySelector('[data-copy-status]')
const command = document.querySelector('[data-command]')

const updateHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 20)
const closeMenu = (restoreFocus = false) => {
  menuButton?.setAttribute('aria-expanded', 'false')
  menuButton?.setAttribute('aria-label', 'Open navigation')
  navLinks?.classList.remove('is-open')
  if (restoreFocus) menuButton?.focus()
}

updateHeader()
window.addEventListener('scroll', updateHeader, { passive: true })

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

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
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
    { threshold: 0.12 },
  )
  reveals.forEach((element) => observer.observe(element))
}
