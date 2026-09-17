const header = document.querySelector('[data-header]')
const menuButton = document.querySelector('[data-menu-button]')
const navLinks = document.querySelector('#nav-links')
const copyButton = document.querySelector('[data-copy]')
const command = document.querySelector('[data-command]')

const updateHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 20)
updateHeader()
window.addEventListener('scroll', updateHeader, { passive: true })

menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true'
  menuButton.setAttribute('aria-expanded', String(open))
  menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation')
  navLinks?.classList.toggle('is-open', open)
})

navLinks?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    menuButton?.setAttribute('aria-expanded', 'false')
    navLinks.classList.remove('is-open')
  })
})

copyButton?.addEventListener('click', async () => {
  if (!command?.textContent) return
  try {
    await navigator.clipboard.writeText(command.textContent)
    copyButton.textContent = 'Copied'
    window.setTimeout(() => (copyButton.textContent = 'Copy'), 1600)
  } catch {
    copyButton.textContent = 'Select text to copy'
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
