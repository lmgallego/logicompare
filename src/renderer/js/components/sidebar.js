export function initSidebar(onNavigate) {
  const navItems = document.querySelectorAll('[data-page]')

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault()
      const page = item.dataset.page

      navItems.forEach(el => el.classList.remove('active'))
      item.classList.add('active')

      onNavigate(page)
    })
  })
}

export function setActivePage(pageId) {
  document.querySelectorAll('[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === pageId)
  })
}
