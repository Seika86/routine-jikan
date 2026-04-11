import { useState } from 'react'

interface Props {
  groupId: string
  groupName: string
  isShared: boolean
  onSave: (updates: { name?: string; isShared?: boolean }) => Promise<void>
  onClose: () => void
}

export function GroupEditModal({ groupName, isShared, onSave, onClose }: Props) {
  const [name, setName] = useState(groupName)
  const [shared, setShared] = useState(isShared)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    await onSave({ name, isShared: shared })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center">
      <div className="bg-surface w-full max-w-lg rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto space-y-5">
        {/* ヘッダー */}
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg">グループ設定</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text text-xl">×</button>
        </div>

        {/* グループ名 */}
        <div className="space-y-1">
          <label className="text-text-muted text-sm">グループ名</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-surface-light rounded-lg px-3 py-2 text-text"
          />
        </div>

        {/* 共有グループ切り替え */}
        <div className="space-y-1">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              className="w-5 h-5 accent-primary"
            />
            <div>
              <span className="text-text text-sm font-medium">★ 共有グループ</span>
              <p className="text-text-dim text-xs">ONにすると、他のルーチンからも追加できます</p>
            </div>
          </label>
        </div>

        {/* 保存ボタン */}
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="w-full bg-primary hover:bg-primary-dark disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  )
}
