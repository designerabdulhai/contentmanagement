<div>
    <form wire:submit.prevent="save" class="space-y-4 bg-white p-4 rounded shadow">
        <div class="grid grid-cols-2 gap-3">
            <div>
                <label class="block text-sm">Project Name</label>
                <input type="text" wire:model.debounce.300ms="state.project_name" class="w-full border rounded px-2 py-2" />
            </div>
            <div>
                <label class="block text-sm">Content Type</label>
                <input type="text" wire:model="state.content_type" class="w-full border rounded px-2 py-2" />
            </div>
            <div>
                <label class="block text-sm">Channel</label>
                <input type="text" wire:model="state.channel" class="w-full border rounded px-2 py-2" />
            </div>
            <div>
                <label class="block text-sm">Platform</label>
                <input type="text" wire:model="state.platform" class="w-full border rounded px-2 py-2" />
            </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
            <div>
                <label class="block text-sm">Status</label>
                <select wire:model="state.status" class="w-full border rounded px-2 py-2">
                    <option value="listed">Listed</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="uploaded">Uploaded</option>
                </select>
            </div>
            <div>
                <label class="block text-sm">Date & Time</label>
                <input type="datetime-local" wire:model="state.scheduled_at" class="w-full border rounded px-2 py-2" />
            </div>
        </div>

        <div>
            <label class="block text-sm">Uploaded Link</label>
            <input type="text" wire:model="state.uploaded_link" x-on:paste="(e)=>{ /* paste detection can be implemented with Alpine */ }" class="w-full border rounded px-2 py-2" />
        </div>

        <div class="flex justify-end gap-2">
            <button type="button" wire:click.prevent="saveAsTemplate(prompt('Template name'))" class="px-4 py-2 border rounded">Save as Template</button>
            <button type="submit" class="px-4 py-2 bg-indigo-600 text-white rounded">Save</button>
        </div>
    </form>
</div>
