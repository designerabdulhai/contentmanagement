<div>
    <div class="bg-white rounded p-4 shadow">
        <h3 class="font-semibold">Dropdown Options</h3>
        <div class="grid grid-cols-3 gap-4 mt-3">
            <div>
                <h4 class="font-medium">Content Types</h4>
                <ul>
                @foreach($options['content_type'] ?? [] as $opt)
                    <li>{{ $opt->value }}</li>
                @endforeach
                </ul>
            </div>
            <div>
                <h4 class="font-medium">Channels</h4>
                <ul>
                @foreach($options['channel'] ?? [] as $opt)
                    <li>{{ $opt->value }}</li>
                @endforeach
                </ul>
            </div>
            <div>
                <h4 class="font-medium">Statuses</h4>
                <ul>
                @foreach($options['status'] ?? [] as $opt)
                    <li>{{ $opt->value }}</li>
                @endforeach
                </ul>
            </div>
        </div>
    </div>
</div>
