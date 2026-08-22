<div>
    <div class="flex items-center justify-between mb-4">
        <div>
            <input type="text" wire:model.debounce.300ms="search" placeholder="Search posts" class="border rounded px-3 py-2" />
        </div>
        <div>
            <a href="{{ route('posts.create') }}" class="bg-indigo-600 text-white px-4 py-2 rounded">New Post</a>
        </div>
    </div>

    @if($view === 'list')
        <div class="bg-white rounded shadow">
            <table class="min-w-full">
                <thead><tr><th class="p-3">Project</th><th class="p-3">Type</th><th class="p-3">Channel</th><th class="p-3">Status</th><th class="p-3">Date</th><th class="p-3">Actions</th></tr></thead>
                <tbody>
                @foreach($posts as $post)
                    <tr class="border-t">
                        <td class="p-3">{{ $post->project_name }}</td>
                        <td class="p-3">{{ $post->content_type }}</td>
                        <td class="p-3">{{ $post->channel }}</td>
                        <td class="p-3">@if($post->is_overdue) <span class="text-red-600">Overdue</span> @else {{ $post->status }} @endif</td>
                        <td class="p-3">{{ $post->scheduled_at }}</td>
                        <td class="p-3">
                            <button wire:click="duplicate({{ $post->id }})" class="mr-2">Duplicate</button>
                            <button wire:click="markUploaded({{ $post->id }})" class="mr-2">Mark Uploaded</button>
                        </td>
                    </tr>
                @endforeach
                </tbody>
            </table>
        </div>
        <div class="mt-4">{{ $posts->links() }}</div>
    @else
        {{-- Calendar view placeholder: FullCalendar will be initialized in the Blade and call endpoints for events and eventDrop --}}
        <div id="calendar" class="bg-white rounded-lg shadow p-4"></div>
        <script>
            document.addEventListener('livewire:load', function(){
                const calendarEl = document.getElementById('calendar');
                const calendar = new FullCalendar.Calendar(calendarEl, {
                    initialView: 'dayGridMonth',
                    events: '/api/fullcalendar-events',
                    editable: true,
                    eventDrop(info){
                        // fire a small fetch to update scheduled_at
                        fetch(`/posts/${info.event.id}/reschedule`, { method: 'POST', headers:{'Content-Type':'application/json','X-CSRF-TOKEN':'{{ csrf_token() }}'}, body: JSON.stringify({ scheduled_at: info.event.start.toISOString() }) })
                        .then(()=> window.livewire.emit('refreshPosts'));
                    }
                });
                calendar.render();
            });
        </script>
    @endif
</div>
