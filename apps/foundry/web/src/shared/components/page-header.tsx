/** Masthead shared by every control surface: kicker, title, heat rule. */
export function PageHeader({
  title,
  children,
  below,
}: {
  title: string
  children?: React.ReactNode
  below?: React.ReactNode
}) {
  return (
    <header className="z-20 bg-iron-900/85 backdrop-blur-md lg:sticky lg:top-0">
      <div className="flex flex-col gap-3 px-4 pb-4 pt-5 sm:flex-row sm:items-end sm:justify-between lg:px-6 lg:pt-6">
        <div>
          <div className="kicker">Foundry control</div>
          <h1 className="mt-1.5 text-[22px] font-extrabold uppercase leading-none tracking-[0.06em] text-txt sm:text-[26px]">
            {title}
          </h1>
        </div>
        {children && <div className="flex items-center gap-4 sm:gap-5">{children}</div>}
      </div>
      <div className="heat-rule" />
      {below}
    </header>
  )
}
