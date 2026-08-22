<?php

namespace App\Http\Livewire;

use Livewire\Component;
use Livewire\WithPagination;
use App\Models\ScheduledPost;

class PostsIndex extends Component
{
    use WithPagination;
    public $search = '';
    public $view = 'list'; // list or calendar
    public $filters = [];

    protected $queryString = ['search'];

    public function render()
    {
        $query = ScheduledPost::query();
        if($this->search) $query->where('project_name','like','%'.$this->search.'%');
        if(!empty($this->filters['my_posts'])) $query->where('created_by', auth()->id());
        $posts = $query->orderBy('is_overdue','desc')->orderBy('scheduled_at','asc')->paginate(15);
        return view('livewire.posts-index', ['posts'=>$posts]);
    }

    public function duplicate($id){
        $original = ScheduledPost::find($id);
        if(!$original) return;
        $data = $original->replicate()->toArray();
        unset($data['id']);
        $data['scheduled_at'] = null;
        $data['status'] = 'listed';
        ScheduledPost::create($data);
        $this->emit('refreshPosts');
    }

    public function markUploaded($id){
        $p = ScheduledPost::find($id);
        if($p){ $p->status='uploaded'; $p->save(); $this->emit('refreshPosts'); }
    }
}
