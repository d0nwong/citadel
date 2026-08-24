import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'
import { createBlueprint, updateBlueprint } from '../api'
import { blueprintQueries } from '../queries'
import { STEP_EFFORTS, STEP_MODELS, TASK_PLACEHOLDER } from '../types'
import type { Blueprint, BlueprintInput, BlueprintStep, StepEffort, StepModel } from '../types'

// A plain <label>: shadcn's Label ships `text-sm`, which beats `.kicker`.
const FieldLabel = ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
  <label htmlFor={htmlFor} className="kicker mb-2 block">
    {children}
  </label>
)

const FIELD = 'border-iron-700 bg-iron-900 font-mono text-[13px] placeholder:text-txt-faint focus-visible:ring-ember-deep'
const NO_EFFORT = 'default'

const blankStep = (): BlueprintStep => ({ name: '', model: 'sonnet', prompt: '' })

/** Create when `blueprint` is absent, edit otherwise. The trigger is the caller's. */
export function BlueprintEditorDialog({ blueprint, trigger }: { blueprint?: Blueprint; trigger: React.ReactNode }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState<Array<BlueprintStep>>([blankStep()])

  // Seed from the blueprint each time the dialog opens, so a cancelled edit
  // never leaks into the next one.
  const load = () => {
    setName(blueprint?.name ?? '')
    setDescription(blueprint?.description ?? '')
    setSteps(blueprint ? blueprint.steps.map((s) => ({ ...s })) : [blankStep()])
  }

  const mutation = useMutation({
    mutationFn: (input: BlueprintInput) =>
      blueprint ? updateBlueprint({ data: { id: blueprint.id, ...input } }) : createBlueprint({ data: input }),
    onSuccess: (bp) => {
      qc.invalidateQueries({ queryKey: blueprintQueries.all })
      toast.success(blueprint ? `Blueprint "${bp.name}" saved` : `Blueprint "${bp.name}" created`)
      setOpen(false)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const patchStep = (i: number, patch: Partial<BlueprintStep>) =>
    setSteps((s) => s.map((step, j) => (j === i ? { ...step, ...patch } : step)))
  const moveStep = (i: number, dir: -1 | 1) =>
    setSteps((s) => {
      const j = i + dir
      if (j < 0 || j >= s.length) return s
      const next = [...s]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  const removeStep = (i: number) => setSteps((s) => s.filter((_, j) => j !== i))

  const ready =
    name.trim() !== '' && steps.length > 0 && steps.every((s) => s.name.trim() !== '' && s.prompt.trim() !== '')

  const submit = () => {
    if (!ready) return
    mutation.mutate({ name, description: description.trim() || undefined, steps })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) load()
        setOpen(v)
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="flex max-h-[92vh] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden border-hairline bg-iron-850 p-0 sm:max-w-2xl">
        <div className="h-px w-full bg-gradient-to-r from-ember via-ember-deep to-transparent" />
        <DialogHeader className="space-y-1 px-5 pb-5 pt-5 text-left sm:px-6">
          <DialogTitle className="text-[17px] font-bold tracking-tight">
            {blueprint ? 'Edit blueprint' : 'New blueprint'}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-txt-dim">
            Steps run in order inside one forge, sharing one session — each on the model you pick.
            Use <span className="font-mono text-txt">{TASK_PLACEHOLDER}</span> in a prompt for the job&apos;s task.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto border-t border-hairline px-5 py-5 sm:px-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
            <div>
              <FieldLabel htmlFor="bp-name">Name</FieldLabel>
              <Input
                id="bp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Plan → Execute"
                className={`h-10 ${FIELD}`}
              />
            </div>
            <div>
              <FieldLabel htmlFor="bp-desc">Description</FieldLabel>
              <Input
                id="bp-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="optional"
                className={`h-10 ${FIELD}`}
              />
            </div>
          </div>

          <div className="space-y-3">
            <FieldLabel>Steps</FieldLabel>
            {steps.map((step, i) => (
              <div key={i} className="space-y-3 rounded-md border border-hairline bg-iron-900/60 p-3.5">
                <div className="flex items-center gap-2">
                  <span className="w-6 shrink-0 font-mono text-[11px] text-txt-faint">{i + 1}.</span>
                  <Input
                    aria-label={`Step ${i + 1} name`}
                    value={step.name}
                    onChange={(e) => patchStep(i, { name: e.target.value })}
                    placeholder="plan"
                    className={`h-9 min-w-0 flex-1 ${FIELD}`}
                  />
                  <Select value={step.model} onValueChange={(v) => patchStep(i, { model: v as StepModel })}>
                    <SelectTrigger aria-label={`Step ${i + 1} model`} className={`h-9 w-[110px] ${FIELD}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-hairline bg-iron-800 font-mono text-[13px]">
                      {STEP_MODELS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={step.effort ?? NO_EFFORT}
                    onValueChange={(v) => patchStep(i, { effort: v === NO_EFFORT ? undefined : (v as StepEffort) })}
                  >
                    <SelectTrigger aria-label={`Step ${i + 1} effort`} className={`h-9 w-[118px] ${FIELD}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-hairline bg-iron-800 font-mono text-[13px]">
                      <SelectItem value={NO_EFFORT}>effort: default</SelectItem>
                      {STEP_EFFORTS.map((e) => (
                        <SelectItem key={e} value={e}>
                          effort: {e}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="flex shrink-0 items-center text-txt-faint">
                    <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} title="Move up" className="p-1 hover:text-txt disabled:opacity-30">
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} title="Move down" className="p-1 hover:text-txt disabled:opacity-30">
                      <ArrowDown className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => removeStep(i)} disabled={steps.length === 1} title="Remove step" className="p-1 hover:text-crack disabled:opacity-30">
                      <Trash2 className="size-3.5" />
                    </button>
                  </span>
                </div>
                <Textarea
                  aria-label={`Step ${i + 1} prompt`}
                  value={step.prompt}
                  onChange={(e) => patchStep(i, { prompt: e.target.value })}
                  rows={3}
                  placeholder={`${TASK_PLACEHOLDER} — follow the /work skill's planning phase: explore the code and write a plan to ~/plan.md. Do not edit /work yet.`}
                  className="resize-none border-iron-700 bg-iron-900 text-[13px] leading-relaxed placeholder:text-txt-faint focus-visible:ring-ember-deep"
                />
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => setSteps((s) => [...s, blankStep()])}
              className="h-8 gap-1.5 border-iron-700 bg-transparent text-[12px] text-txt-dim hover:bg-iron-800 hover:text-txt"
            >
              <Plus className="size-3.5" />
              Add step
            </Button>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-hairline bg-iron-900/60 px-5 py-4 sm:px-6">
          <Button variant="ghost" onClick={() => setOpen(false)} className="h-9 text-[13px] text-txt-dim hover:text-txt">
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!ready || mutation.isPending}
            className="h-9 gap-2 bg-ember px-5 text-[13px] font-semibold text-primary-foreground hover:bg-ember-soft disabled:opacity-40"
          >
            {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
            {blueprint ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
