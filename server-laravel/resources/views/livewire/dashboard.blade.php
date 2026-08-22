<div>
    <div class="grid grid-cols-4 gap-4 mb-6">
        <div class="bg-white rounded-xl p-4 shadow">Total posts<br><div class="text-2xl font-bold">{{ \App\Models\ScheduledPost::count() }}</div></div>
        <div class="bg-white rounded-xl p-4 shadow">Scheduled this week<br><div class="text-2xl font-bold">{{ \App\Models\ScheduledPost::whereBetween('scheduled_at',[now(), now()->addDays(7)])->count() }}</div></div>
        <div class="bg-white rounded-xl p-4 shadow">Uploaded this month<br><div class="text-2xl font-bold">{{ \App\Models\ScheduledPost::where('status','uploaded')->whereMonth('created_at', now()->month)->count() }}</div></div>
        <div class="bg-white rounded-xl p-4 shadow">Listed<br><div class="text-2xl font-bold">{{ \App\Models\ScheduledPost::where('status','listed')->count() }}</div></div>
    </div>

    <div class="grid grid-cols-2 gap-4">
        <div class="bg-white rounded-xl p-4 shadow">
            <h3 class="font-semibold mb-2">Posts by Channel</h3>
            <canvas id="channelChart"></canvas>
        </div>
        <div class="bg-white rounded-xl p-4 shadow">
            <h3 class="font-semibold mb-2">Posts by Content Type</h3>
            <canvas id="typeChart"></canvas>
        </div>
    </div>

    <div class="mt-6 bg-white rounded-xl p-4 shadow">
        <h4 class="font-semibold">Due Today / This Week</h4>
        <ul>
            @foreach($dueSoon as $p)
                <li class="flex justify-between py-2">
                    <div>{{ $p->project_name }} · {{ $p->channel }} · {{ $p->scheduled_at }}</div>
                    <div><button wire:click="markUploaded({{ $p->id }})" class="text-sm px-3 py-1 bg-indigo-600 text-white rounded">Mark Uploaded</button></div>
                </li>
            @endforeach
        </ul>
    </div>

    <script>
        document.addEventListener('livewire:load', function(){
            // Chart placeholders: data can be supplied via props or AJAX
        });
    </script>
</div>
