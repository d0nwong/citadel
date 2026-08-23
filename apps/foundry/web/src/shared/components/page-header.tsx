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
    <header className="sticky top-0 z-20 bg-iron-900/85 backdrop-blur-md">
      <div className="flex items-end justify-between px-6 pb-4 pt-6">
        <div>
          <div className="kicker">Foundry control</div>
          <h1 className="mt-1.5 text-[26px] font-extrabold uppercase leading-none tracking-[0.06em] text-txt">
            {title}
          </h1>
        </div>
        {children && <div className="flex items-center gap-5">{children}</div>}
      </div>
      <div className="heat-rule" />
      {below}
    </header>
  )
}
