import { Label } from '@/components/ui/label'

export function SettingRow(props: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className='space-y-1.5'>
      <Label htmlFor={props.htmlFor} className='text-xs'>
        {props.label}
      </Label>
      {props.children}
    </div>
  )
}
