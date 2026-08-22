<?php

namespace App\Http\Livewire;

use Livewire\Component;
use App\Models\ScheduledPost;

class Dashboard extends Component
{
    public $dueSoon = [];

    public function mount(){
        $this->loadDueSoon();
    }

    public function loadDueSoon(){
        $this->dueSoon = ScheduledPost::whereNotNull('scheduled_at')
            ->where('scheduled_at', '>=', now())
            ->where('scheduled_at', '<', now()->addDays(7))
            ->where('status', '!=', 'uploaded')
            ->orderBy('scheduled_at')
            ->take(5)->get();
    }

    public function markUploaded($id){
        $p = ScheduledPost::find($id);
        if($p){ $p->status = 'uploaded'; $p->save(); $this->loadDueSoon(); }
    }

    public function render()
    {
        return view('livewire.dashboard');
    }
}
